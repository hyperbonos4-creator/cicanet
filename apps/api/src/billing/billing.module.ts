import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { RolesGuard } from '../auth/guards';

/** Facturación recurrente por ciclo. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [BillingController],
  providers: [BillingService, RolesGuard],
  exports: [BillingService],
})
export class BillingModule {}
