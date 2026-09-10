import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, DebugController],
})
export class HealthModule {}
