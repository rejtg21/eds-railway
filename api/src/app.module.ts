import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from './config/env';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { OutboxModule } from './outbox/outbox.module';
import { OrdersModule } from './orders/orders.module';
import { ConsumersModule } from './consumers/consumers.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          autoLogging: true,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
      }),
    }),
    PrismaModule,
    EventsModule,
    OutboxModule,
    OrdersModule,
    ConsumersModule,
    HealthModule,
  ],
})
export class AppModule {}
