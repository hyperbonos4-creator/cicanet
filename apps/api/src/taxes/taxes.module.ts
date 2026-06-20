import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';
import { RolesGuard } from '../auth/guards';

/** Motor de impuestos por reglas. Módulo hoja; exporta TaxesService. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TaxesController],
  providers: [TaxesService, RolesGuard],
  exports: [TaxesService],
})
export class TaxesModule {}
