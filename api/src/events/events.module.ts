import { Global, Module } from '@nestjs/common';
import { EVENT_BUS } from './event-bus';
import { PgBossEventBus } from './pgboss-event-bus';

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      // Phase 2: swap for BullMqEventBus (Redis). Nothing else changes.
      useClass: PgBossEventBus,
    },
  ],
  exports: [EVENT_BUS],
})
export class EventsModule {}
