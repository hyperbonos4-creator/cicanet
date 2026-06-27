import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { CollectionsModule } from '../collections/collections.module';
import { WhatsappModule } from '../../channels/whatsapp/whatsapp.module';
import { DunningService } from './dunning.service';
import { DunningController } from './dunning.controller';
import { RolesGuard } from '../../platform/auth/guards';

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
