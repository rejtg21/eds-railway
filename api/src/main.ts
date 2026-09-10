import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    cors: true,
  });

  app.useLogger(app.get(Logger));

  // Graceful shutdown: triggers onModuleDestroy / onApplicationShutdown so the
  // outbox relay stops polling and pg-boss drains in-flight jobs before exit.
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port, '0.0.0.0');

  app
    .get(Logger)
    .log(
      `API listening on :${port} (APP_ROLE=${process.env.APP_ROLE ?? 'all'})`,
      'Bootstrap',
    );
}

void bootstrap();
