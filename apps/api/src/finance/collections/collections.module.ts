import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { CollectionsService } from './collections.service';
import { CollectionsController } from './collections.controller';
import { RolesGuard } from '../../platform/auth/guards';

/**
 * Cartera y cobranza (aging de CxC). Módulo "hoja": exporta CollectionsService
 * para que dunning (T1.4) y Cica contable (F4) lo reutilicen sin ciclos.
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [CollectionsController],
  providers: [CollectionsService, RolesGuard],
  exports: [CollectionsService],
})
export class CollectionsModule {}
