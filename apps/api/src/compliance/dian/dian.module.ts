import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { ExogenaModule } from '../exogena/exogena.module';
import { DianService } from './dian.service';
import { DianController } from './dian.controller';
import { RolesGuard } from '../../platform/auth/guards';

/** Centro DIAN unificado. Reutiliza ExogenaService para mapeo/validación. */
@Module({
  imports: [AuthModule, PrismaModule, ExogenaModule],
  controllers: [DianController],
  providers: [DianService, RolesGuard],
  exports: [DianService],
})
export class DianModule {}
