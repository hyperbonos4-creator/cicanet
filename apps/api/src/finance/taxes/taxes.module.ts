import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';
import { RolesGuard } from '../../platform/auth/guards';

/** Motor de impuestos por reglas. Módulo hoja; exporta TaxesService. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TaxesController],
  providers: [TaxesService, RolesGuard],
  exports: [TaxesService],
})
export class TaxesModule {}
