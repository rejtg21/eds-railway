import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EVENT_NAMES } from '../events/event-names';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * The write path. One transaction:
   *   1. insert the Order row
   *   2. stage an `order.created` outbox event
   * Both commit together, or neither does. The relay picks it up afterwards.
   */
  async createOrder(dto: CreateOrderDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          customer: dto.customer,
          amountCents: dto.amountCents,
          status: 'PENDING',
        },
      });

      const eventId = await this.outbox.stage(tx, {
        name: EVENT_NAMES.ORDER_CREATED,
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          customer: order.customer,
          amountCents: order.amountCents,
        },
      });

      return { order, eventId };
    });

    this.logger.log(
      `order ${result.order.id} created; staged event ${result.eventId}`,
    );
    return result;
  }

  list() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  async getWithAudit(id: string) {
    const [order, audit] = await Promise.all([
      this.prisma.order.findUnique({ where: { id } }),
      this.prisma.orderAudit.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return { order, audit };
  }
}
