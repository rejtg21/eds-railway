import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` at most once per (consumer, eventId).
   *
   * `work` and the ProcessedEvent marker are written in ONE transaction, so a
   * crash before commit re-runs cleanly and a re-delivery after commit is a
   * no-op. Concurrent duplicate deliveries collide on the primary key (P2002)
   * and the loser simply skips.
   *
   * @returns true if the work ran, false if it was already processed.
   */
  async runOnce(
    consumer: string,
    eventId: string,
    work: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    const seen = await this.prisma.processedEvent.findUnique({
      where: { consumer_eventId: { consumer, eventId } },
    });
    if (seen) return false;

    try {
      await this.prisma.$transaction(async (tx) => {
        await work(tx);
        await tx.processedEvent.create({ data: { consumer, eventId } });
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }
}
