import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { TesoreriaService } from './tesoreria.service';
import { TesoreriaController } from './tesoreria.controller';
import { RolesGuard } from '../../platform/auth/guards';

/** Tesorería. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [TesoreriaController],
  providers: [TesoreriaService, RolesGuard],
  exports: [TesoreriaService],
})
export class TesoreriaModule {}
