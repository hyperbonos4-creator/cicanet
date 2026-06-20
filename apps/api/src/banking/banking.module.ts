import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { BankingService } from './banking.service';
import { BankingController } from './banking.controller';
import { RolesGuard } from '../auth/guards';

/** Conciliación bancaria. Genera asientos vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [BankingController],
  providers: [BankingService, RolesGuard],
  exports: [BankingService],
})
export class BankingModule {}
