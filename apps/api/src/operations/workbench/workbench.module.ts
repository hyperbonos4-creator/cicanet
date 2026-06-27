import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { AccountingModule } from '../../finance/accounting/accounting.module';
import { CollectionsModule } from '../../finance/collections/collections.module';
import { DianModule } from '../../compliance/dian/dian.module';
import { AssetRegistryModule } from '../../finance/asset-registry/asset-registry.module';
import { WorkbenchService } from './workbench.service';
import { WorkbenchController } from './workbench.controller';
import { RolesGuard } from '../../platform/auth/guards';

/**
 * Workbench del contador. Bandeja de pendientes + centro de control financiero
 * (alertas, indicadores de salud, calendario tributario). Reúsa los servicios de
 * reportes/cartera/cierre/DIAN/activos como fuente única de verdad.
 */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule, CollectionsModule, DianModule, AssetRegistryModule],
  controllers: [WorkbenchController],
  providers: [WorkbenchService, RolesGuard],
})
export class WorkbenchModule {}
