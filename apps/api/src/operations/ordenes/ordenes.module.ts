import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { OrdenesService } from './ordenes.service';
import { OrdenesController } from './ordenes.controller';
import { MisOrdenesController } from './mis-ordenes.controller';
import { RolesGuard } from '../../platform/auth/guards';
import { UsersModule } from '../../platform/users/users.module';

/**
 * Órdenes de trabajo de campo. Módulo "hoja" (nadie lo importa) para no crear
 * ciclos de dependencias. MisOrdenesController va primero para que la ruta
 * literal `ordenes/mias` tenga prioridad sobre `ordenes/:id`.
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [MisOrdenesController, OrdenesController],
  providers: [OrdenesService, RolesGuard],
})
export class OrdenesModule {}
