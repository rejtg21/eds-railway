import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../config/env';
import { EVENT_BUS, type EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OutboxRow {
  id: string;
  event_id: string;
  event_name: string;
  aggregate_id: string;
  payload: unknown;
  attempts: number;
}

/**
 * The relay. Polls PENDING outbox rows with `FOR UPDATE SKIP LOCKED` so many
 * instances can run concurrently without double-dispatching, publishes each to
 * the bus, and flips the row to PUBLISHED in the same transaction.
 *
 * Publishing happens inside the DB transaction: if the process dies mid-batch
 * the row stays PENDING and is retried -> at-least-once delivery, which is why
 * consumers are idempotent.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    const role = this.config.get('APP_ROLE', { infer: true });
    if (role !== 'all' && role !== 'relay') {
      this.logger.log(`Outbox relay disabled (APP_ROLE=${role})`);
      return;
    }
    const interval = this.config.get('OUTBOX_POLL_INTERVAL_MS', {
      infer: true,
    });
    this.timer = setInterval(() => void this.tick(), interval);
    this.logger.log(`Outbox relay polling every ${interval}ms`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (let i = 0; i < 50 && this.running; i++) await sleep(100);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const n = await this.dispatchBatch();
      if (n > 0) this.logger.debug(`relayed ${n} event(s)`);
    } catch (err) {
      this.logger.error(`relay tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Exposed for tests / manual triggering. Returns number published. */
  async dispatchBatch(): Promise<number> {
    const batchSize = this.config.get('OUTBOX_BATCH_SIZE', { infer: true });
    const maxAttempts = this.config.get('OUTBOX_MAX_ATTEMPTS', { infer: true });

    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, event_id, event_name, aggregate_id, payload, attempts
          FROM outbox_events
          WHERE status = 'PENDING'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        `;

        let published = 0;
        for (const row of rows) {
          try {
            await this.bus.publish({
              id: row.event_id,
              name: row.event_name,
              payload: row.payload,
              occurredAt: new Date().toISOString(),
            });
            await tx.$executeRaw`
              UPDATE outbox_events
              SET status = 'PUBLISHED', published_at = now(), attempts = attempts + 1
              WHERE id = ${row.id}
            `;
            published++;
          } catch (err) {
            const attempts = row.attempts + 1;
            const dead = attempts >= maxAttempts;
            await tx.$executeRaw`
              UPDATE outbox_events
              SET attempts = ${attempts},
                  status = ${dead ? 'DEAD' : 'PENDING'}
              WHERE id = ${row.id}
            `;
            this.logger.error(
              `publish failed for event ${row.event_id} ` +
                `(attempt ${attempts}${dead ? ', marked DEAD' : ''}): ${
                  (err as Error).message
                }`,
            );
          }
        }
        return published;
      },
      { timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
