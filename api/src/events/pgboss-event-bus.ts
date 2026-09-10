import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import type { Env } from '../config/env';
import { pgBossConnectionString } from '../config/env';
import type { EventBus, EventHandler, IntegrationEvent } from './event-bus';

/** pg-boss queue names: keep to a safe charset. */
const queueName = (eventName: string) =>
  eventName.replace(/[^a-zA-Z0-9_-]/g, '_');

@Injectable()
export class PgBossEventBus
  implements EventBus, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PgBossEventBus.name);
  private readonly boss: PgBoss;
  private started = false;
  private readonly ensuredQueues = new Set<string>();

  constructor(private readonly config: ConfigService<Env, true>) {
    const connectionString = pgBossConnectionString({
      DATABASE_URL: this.config.get('DATABASE_URL', { infer: true }),
      DIRECT_URL: this.config.get('DIRECT_URL', { infer: true }),
      PGBOSS_DATABASE_URL: this.config.get('PGBOSS_DATABASE_URL', {
        infer: true,
      }),
    });

    this.boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      // keep the pg-boss pool small - the container already holds a Prisma pool
      max: 4,
    });
    this.boss.on('error', (err) =>
      this.logger.error(`pg-boss error: ${err.message}`, err.stack),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
    this.logger.log('pg-boss started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.boss.stop({ graceful: true, close: true });
    this.logger.log('pg-boss stopped');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async publish(event: IntegrationEvent): Promise<void> {
    await this.ready();
    const q = queueName(event.name);
    await this.ensureQueue(q);
    await this.boss.send(q, event as unknown as Record<string, unknown>, {
      // If the relay re-publishes the same outbox row (at-least-once), this keeps
      // a duplicate out of the queue while one copy is still pending. The
      // consumer's ProcessedEvent ledger is the real exactly-once guarantee.
      singletonKey: event.id,
      retryLimit: 10,
      retryDelay: 5,
      retryBackoff: true,
    });
  }

  async subscribe(
    eventName: string,
    consumerName: string,
    handler: EventHandler,
  ): Promise<void> {
    await this.ready();
    const q = queueName(eventName);
    await this.ensureQueue(q);

    await this.boss.work<IntegrationEvent>(
      q,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async ([job]) => {
        this.logger.debug(
          `[${consumerName}] ${eventName} job=${job.id} eventId=${job.data.id}`,
        );
        // Throwing here makes pg-boss retry per the send() retry options.
        await handler(job.data);
      },
    );

    this.logger.log(
      `[${consumerName}] subscribed to ${eventName} (queue=${q})`,
    );
  }

  private async ready(): Promise<void> {
    if (!this.started) await this.start();
  }

  private async ensureQueue(q: string): Promise<void> {
    if (this.ensuredQueues.has(q)) return;
    await this.boss.createQueue(q);
    this.ensuredQueues.add(q);
  }
}
