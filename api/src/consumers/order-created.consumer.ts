import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { EVENT_BUS, type EventBus, type IntegrationEvent } from '../events/event-bus';
import { EVENT_NAMES } from '../events/event-names';
import { IdempotencyService } from './idempotency.service';

const CONSUMER = 'order-created.audit';

interface OrderCreatedPayload {
  orderId: string;
  customer: string;
  amountCents: number;
}

/**
 * Consumes `order.created` and runs the "respective task":
 * mark the order CONFIRMED and write an audit row - atomically with the
 * idempotency marker.
 */
@Injectable()
export class OrderCreatedConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderCreatedConsumer.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly idempotency: IdempotencyService,
  ) {}

  async onModuleInit(): Promise<void> {
    const role = this.config.get('APP_ROLE', { infer: true });
    if (role !== 'all' && role !== 'consumer') {
      this.logger.log(`Consumers disabled (APP_ROLE=${role})`);
      return;
    }
    await this.bus.subscribe(EVENT_NAMES.ORDER_CREATED, CONSUMER, (event) =>
      this.handle(event),
    );
  }

  private async handle(event: IntegrationEvent): Promise<void> {
    const { orderId } = event.payload as OrderCreatedPayload;

    const ran = await this.idempotency.runOnce(CONSUMER, event.id, async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CONFIRMED' },
      });
      await tx.orderAudit.create({
        data: {
          orderId,
          message: `order.created processed by ${CONSUMER}; order marked CONFIRMED`,
        },
      });
      // stand-in for real work (send email, call payments, ...)
      await new Promise((r) => setTimeout(r, 150));
    });

    this.logger.log(
      ran
        ? `processed order.created for order ${orderId}`
        : `skipped duplicate order.created (eventId=${event.id})`,
    );
  }
}
