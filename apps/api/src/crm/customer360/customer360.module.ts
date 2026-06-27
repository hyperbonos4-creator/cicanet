import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { InfraModule } from '../../network/infra/infra.module';
import { Customer360Controller } from './customer360.controller';
import { Customer360Service } from './customer360.service';
import { RolesGuard } from '../../platform/auth/guards';

@Module({
  imports: [AuthModule, PrismaModule, InfraModule],
  controllers: [Customer360Controller],
  providers: [Customer360Service, RolesGuard],
})
export class Customer360Module {}
