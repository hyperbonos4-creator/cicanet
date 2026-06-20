import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PayablesService } from './payables.service';
import { PayablesController } from './payables.controller';
import { RolesGuard } from '../auth/guards';

/** Cuentas por pagar. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [PayablesController],
  providers: [PayablesService, RolesGuard],
  exports: [PayablesService],
})
export class PayablesModule {}
