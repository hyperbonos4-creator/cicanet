import { Module } from '@nestjs/common';

// ── platform ── cross-cutting technical foundation
import { PrismaModule } from './platform/prisma/prisma.module';
import { AuditModule } from './platform/audit/audit.module';
import { AuthModule } from './platform/auth/auth.module';
import { DocumentosModule } from './platform/documentos/documentos.module';
import { DemoModule } from './platform/demo/demo.module';

// ── network ── GIS / telco digital twin
import { NetworkModule } from './network/topology/network.module';
import { InfraModule } from './network/infra/infra.module';
import { NetworkEngineModule } from './network/engine/network-engine.module';
import { GeoModule } from './network/geo/geo.module';

// ── crm ── customer relationship & self-service
import { ClientesModule } from './crm/clientes/clientes.module';
import { Customer360Module } from './crm/customer360/customer360.module';
import { MeModule } from './crm/me/me.module';

// ── operations ── field work & support
import { OrdenesModule } from './operations/ordenes/ordenes.module';
import { TicketsModule } from './operations/tickets/tickets.module';
import { SupportModule } from './operations/support/support.module';
import { WorkbenchModule } from './operations/workbench/workbench.module';

// ── finance ── unified accounting kernel + financial modules
import { AccountingModule } from './finance/accounting/accounting.module';
import { BillingModule } from './finance/billing/billing.module';
import { InvoicingModule } from './finance/invoicing/invoicing.module';
import { CarteraModule } from './finance/cartera/cartera.module';
import { CollectionsModule } from './finance/collections/collections.module';
import { DunningModule } from './finance/dunning/dunning.module';
import { PaymentsModule } from './finance/payments/payments.module';
import { CashModule } from './finance/cash/cash.module';
import { BankingModule } from './finance/banking/banking.module';
import { TesoreriaModule } from './finance/tesoreria/tesoreria.module';
import { PayablesModule } from './finance/payables/payables.module';
import { PayrollModule } from './finance/payroll/payroll.module';
import { TaxesModule } from './finance/taxes/taxes.module';
import { PresupuestoModule } from './finance/presupuesto/presupuesto.module';
import { AssetsModule } from './finance/assets/assets.module';
import { AssetRegistryModule } from './finance/asset-registry/asset-registry.module';

// ── compliance ── Colombian regulatory (DIAN)
import { DianModule } from './compliance/dian/dian.module';
import { ExogenaModule } from './compliance/exogena/exogena.module';

// ── channels ── omnichannel + AI assistant
import { WhatsappModule } from './channels/whatsapp/whatsapp.module';
import { AssistantModule } from './channels/assistant/assistant.module';

// ── insights ── analytics & BI
import { AnalyticsModule } from './insights/analytics/analytics.module';

import { HealthController } from './health.controller';

@Module({
  imports: [
    // platform
    PrismaModule,
    AuditModule,
    AuthModule,
    DocumentosModule,
    DemoModule,
    // network
    NetworkModule,
    InfraModule,
    NetworkEngineModule,
    GeoModule,
    // crm
    ClientesModule,
    Customer360Module,
    MeModule,
    // operations
    OrdenesModule,
    TicketsModule,
    SupportModule,
    WorkbenchModule,
    // finance
    AccountingModule,
    BillingModule,
    InvoicingModule,
    CarteraModule,
    CollectionsModule,
    DunningModule,
    PaymentsModule,
    CashModule,
    BankingModule,
    TesoreriaModule,
    PayablesModule,
    PayrollModule,
    TaxesModule,
    PresupuestoModule,
    AssetsModule,
    AssetRegistryModule,
    // compliance
    DianModule,
    ExogenaModule,
    // channels
    WhatsappModule,
    AssistantModule,
    // insights
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
