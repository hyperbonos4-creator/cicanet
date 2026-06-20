import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás de proxy/Docker: confiar en X-Forwarded-For para obtener la IP real.
  app.set('trust proxy', true);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin, credentials: true });

  // Evidencia fotográfica del Gemelo Digital: se sirve estáticamente bajo
  // /api/uploads para que el proxy de Next (/api/*) y el túnel la alcancen.
  // Las imágenes viven en DATA_DIR/uploads.
  const uploadsDir = resolve(process.cwd(), config.geo.dataDir, 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, {
    prefix: '/api/uploads/',
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  await app.listen(config.port);
  const logger = new Logger('CICANET-API');
  logger.log(`🛰️  API CICANET escuchando en http://localhost:${config.port}/api`);
  logger.log(`🔐 Usuario semilla: ${config.seedAdmin.username} / ${config.seedAdmin.password}`);
}
bootstrap();
