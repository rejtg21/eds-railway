import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { OrderCreatedConsumer } from './order-created.consumer';

@Module({
  providers: [IdempotencyService, OrderCreatedConsumer],
})
export class ConsumersModule {}
