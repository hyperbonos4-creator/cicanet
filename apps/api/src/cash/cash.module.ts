import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { RolesGuard } from '../auth/guards';

/** Cash application (recibos de caja). Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [CashController],
  providers: [CashService, RolesGuard],
  exports: [CashService],
})
export class CashModule {}
