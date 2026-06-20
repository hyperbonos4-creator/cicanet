import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { RolesGuard } from '../auth/guards';

/** Analítica vertical de ISP + centros de costo (Fase H). Módulo hoja. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, RolesGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
