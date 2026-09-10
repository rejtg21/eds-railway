import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Convenience endpoint so the web UI can visualise the pipeline. */
@Controller('debug')
export class DebugController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  async stats() {
    const [orders, pending, published, dead, processed, audits] =
      await Promise.all([
        this.prisma.order.count(),
        this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
        this.prisma.outboxEvent.count({ where: { status: 'PUBLISHED' } }),
        this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
        this.prisma.processedEvent.count(),
        this.prisma.orderAudit.count(),
      ]);

    return {
      orders,
      outbox: { pending, published, dead },
      processedEvents: processed,
      audits,
    };
  }
}
