import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { TesoreriaService } from './tesoreria.service';
import { TesoreriaController } from './tesoreria.controller';
import { RolesGuard } from '../auth/guards';

/** Tesorería. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [TesoreriaController],
  providers: [TesoreriaService, RolesGuard],
  exports: [TesoreriaService],
})
export class TesoreriaModule {}
