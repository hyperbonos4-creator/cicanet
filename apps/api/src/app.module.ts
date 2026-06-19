import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { NetworkModule } from './network/network.module';
import { GeoModule } from './geo/geo.module';
import { InfraModule } from './infra/infra.module';
import { ClientesModule } from './clientes/clientes.module';
import { PaymentsModule } from './payments/payments.module';
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
