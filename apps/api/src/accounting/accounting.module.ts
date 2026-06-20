import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingService } from './accounting.service';
import { ReportsService } from './reports.service';
import { PostingEngineService } from './posting-engine.service';
import { AccountingController } from './accounting.controller';
import { RolesGuard } from '../auth/guards';

/**
 * Módulo contable (ledger de doble partida). Es un módulo "hoja": no importa a
 * otros módulos de dominio, así otros (payments, billing) pueden importarlo para
 * contabilizar eventos sin crear ciclos. Exporta AccountingService y el
 * PostingEngine (emisor único de asientos por evento, Fase B).
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AccountingController],
  providers: [AccountingService, ReportsService, PostingEngineService, RolesGuard],
  exports: [AccountingService, PostingEngineService],
})
export class AccountingModule {}
