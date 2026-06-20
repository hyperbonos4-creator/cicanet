import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectionsModule } from '../collections/collections.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { DunningService } from './dunning.service';
import { DunningController } from './dunning.controller';
import { RolesGuard } from '../auth/guards';

/**
 * Cobranza automática. Reusa CollectionsService (aging) y WhatsappService (envío).
 * Ambos son módulos hoja → sin ciclos.
 */
@Module({
  imports: [AuthModule, PrismaModule, CollectionsModule, WhatsappModule],
  controllers: [DunningController],
  providers: [DunningService, RolesGuard],
  exports: [DunningService],
})
export class DunningModule {}
