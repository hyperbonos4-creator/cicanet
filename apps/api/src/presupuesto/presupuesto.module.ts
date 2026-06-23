import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PresupuestoService } from './presupuesto.service';
import { PresupuestoController } from './presupuesto.controller';
import { RolesGuard } from '../auth/guards';

/** Control presupuestal (Presupuesto vs Real). Módulo hoja (prisma directo). */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [PresupuestoController],
  providers: [PresupuestoService, RolesGuard],
  exports: [PresupuestoService],
})
export class PresupuestoModule {}
