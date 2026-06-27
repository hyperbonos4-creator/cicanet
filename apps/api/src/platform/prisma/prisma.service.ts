import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma compartido. Se conecta al iniciar y se desconecta al cerrar.
 * La URL se toma de DATABASE_URL (inyectada por docker-compose).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('PrismaService');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Conectado a PostgreSQL.');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
