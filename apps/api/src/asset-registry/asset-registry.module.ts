import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AssetRegistryService } from './asset-registry.service';
import { AssetRegistryController } from './asset-registry.controller';
import { RolesGuard } from '../auth/guards';

/** Inventario operativo de red (≠ activo fijo contable). Módulo hoja. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AssetRegistryController],
  providers: [AssetRegistryService, RolesGuard],
  exports: [AssetRegistryService],
})
export class AssetRegistryModule {}
