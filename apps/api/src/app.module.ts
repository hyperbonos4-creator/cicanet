import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { NetworkModule } from './network/network.module';
import { GeoModule } from './geo/geo.module';
import { InfraModule } from './infra/infra.module';
import { ClientesModule } from './clientes/clientes.module';
import { PaymentsModule } from './payments/payments.module';
import { SupportModule } from './support/support.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AssistantModule } from './assistant/assistant.module';
import { TicketsModule } from './tickets/tickets.module';
import { MeModule } from './me/me.module';
import { Customer360Module } from './customer360/customer360.module';
import { OrdenesModule } from './ordenes/ordenes.module';
import { AccountingModule } from './accounting/accounting.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { CollectionsModule } from './collections/collections.module';
import { BillingModule } from './billing/billing.module';
import { BankingModule } from './banking/banking.module';
import { DunningModule } from './dunning/dunning.module';
import { PayablesModule } from './payables/payables.module';
import { TaxesModule } from './taxes/taxes.module';
import { AssetsModule } from './assets/assets.module';
import { ExogenaModule } from './exogena/exogena.module';
import { PayrollModule } from './payroll/payroll.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    NetworkModule,
    GeoModule,
    InfraModule,
    ClientesModule,
    PaymentsModule,
    SupportModule,
    WhatsappModule,
    AssistantModule,
    TicketsModule,
    MeModule,
    Customer360Module,
    OrdenesModule,
    AccountingModule,
    InvoicingModule,
    CollectionsModule,
    BillingModule,
    BankingModule,
    DunningModule,
    PayablesModule,
    TaxesModule,
    AssetsModule,
    ExogenaModule,
    PayrollModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
