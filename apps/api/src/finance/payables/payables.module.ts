import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PayablesService } from './payables.service';
import { PayablesController } from './payables.controller';
import { RolesGuard } from '../../platform/auth/guards';

/** Cuentas por pagar. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [PayablesController],
  providers: [PayablesService, RolesGuard],
  exports: [PayablesService],
})
export class PayablesModule {}
