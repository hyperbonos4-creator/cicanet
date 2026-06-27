import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { PresupuestoService } from './presupuesto.service';
import { PresupuestoController } from './presupuesto.controller';
import { RolesGuard } from '../../platform/auth/guards';

/** Control presupuestal (Presupuesto vs Real). Módulo hoja (prisma directo). */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [PresupuestoController],
  providers: [PresupuestoService, RolesGuard],
  exports: [PresupuestoService],
})
export class PresupuestoModule {}
