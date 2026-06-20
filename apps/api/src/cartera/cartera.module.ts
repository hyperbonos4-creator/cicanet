import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CarteraService } from './cartera.service';
import { CarteraController } from './cartera.controller';
import { RolesGuard } from '../auth/guards';

/** Cartera avanzada (acuerdos de pago, castigo). Contabiliza vía AccountingModule. */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [CarteraController],
  providers: [CarteraService, RolesGuard],
  exports: [CarteraService],
})
export class CarteraModule {}
