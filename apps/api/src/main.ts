import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás de proxy/Docker: confiar en X-Forwarded-For para obtener la IP real.
  app.set('trust proxy', true);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  await app.listen(config.port);
  const logger = new Logger('CICANET-API');
  logger.log(`🛰️  API CICANET escuchando en http://localhost:${config.port}/api`);
  logger.log(`🔐 Usuario semilla: ${config.seedAdmin.username} / ${config.seedAdmin.password}`);
}
bootstrap();
