import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Writes an outbox row. MUST be called with the same `tx` that performs the
 * business change, so the event and the state change commit atomically.
 */
@Injectable()
export class OutboxService {
  async stage(
    tx: Prisma.TransactionClient,
    params: {
      name: string;
      aggregateId: string;
      payload: Prisma.InputJsonValue;
    },
  ): Promise<string> {
    const eventId = randomUUID();
    await tx.outboxEvent.create({
      data: {
        eventId,
        eventName: params.name,
        aggregateId: params.aggregateId,
        payload: params.payload,
        status: 'PENDING',
      },
    });
    return eventId;
  }
}
