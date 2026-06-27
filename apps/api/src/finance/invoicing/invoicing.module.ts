import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { EInvoiceClient } from './einvoice.client';
import { RolesGuard } from '../../platform/auth/guards';

/**
 * Facturación electrónica DIAN: orquesta el microservicio `einvoice` y
 * contabiliza el ingreso en el ledger (importa AccountingModule, que es hoja).
 */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [InvoicingController],
  providers: [InvoicingService, EInvoiceClient, RolesGuard],
  exports: [InvoicingService],
})
export class InvoicingModule {}
