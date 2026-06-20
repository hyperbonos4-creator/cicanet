import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkbenchService } from './workbench.service';
import { WorkbenchController } from './workbench.controller';
import { RolesGuard } from '../auth/guards';

/** Workbench del contador (bandeja de pendientes). Módulo hoja (prisma directo). */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [WorkbenchController],
  providers: [WorkbenchService, RolesGuard],
})
export class WorkbenchModule {}
