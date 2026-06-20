import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectionsService } from './collections.service';
import { CollectionsController } from './collections.controller';
import { RolesGuard } from '../auth/guards';

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
