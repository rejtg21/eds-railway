import { Module } from '@nestjs/common';
import { OutboxController } from './outbox.controller';
import { OutboxService } from './outbox.service';
import { OutboxRelayService } from './outbox-relay.service';

@Module({
  controllers: [OutboxController],
  providers: [OutboxService, OutboxRelayService],
  exports: [OutboxService],
})
export class OutboxModule {}
