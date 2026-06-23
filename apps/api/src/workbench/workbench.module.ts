import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CollectionsModule } from '../collections/collections.module';
import { DianModule } from '../dian/dian.module';
import { AssetRegistryModule } from '../asset-registry/asset-registry.module';
import { WorkbenchService } from './workbench.service';
import { WorkbenchController } from './workbench.controller';
import { RolesGuard } from '../auth/guards';

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
