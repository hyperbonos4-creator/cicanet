import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { RolesGuard } from '../auth/guards';

/** Nómina. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [PayrollController],
  providers: [PayrollService, RolesGuard],
  exports: [PayrollService],
})
export class PayrollModule {}
