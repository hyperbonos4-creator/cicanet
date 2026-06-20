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
  ],
  controllers: [HealthController],
})
export class AppModule {}
