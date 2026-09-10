import { Controller, Post } from '@nestjs/common';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * Manual trigger for the outbox relay. With OUTBOX_RELAY_MODE=manual the relay
 * does not poll; the web UI calls this on refresh to advance the pipeline.
 */
@Controller('outbox')
export class OutboxController {
  constructor(private readonly relay: OutboxRelayService) {}

  @Post('drain')
  async drain(): Promise<{ published: number }> {
    const published = await this.relay.dispatchBatch();
    return { published };
  }
}
