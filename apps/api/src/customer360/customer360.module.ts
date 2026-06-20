import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InfraModule } from '../infra/infra.module';
import { Customer360Controller } from './customer360.controller';
import { Customer360Service } from './customer360.service';
import { RolesGuard } from '../auth/guards';

@Module({
  imports: [AuthModule, PrismaModule, InfraModule],
  controllers: [Customer360Controller],
  providers: [Customer360Service, RolesGuard],
})
export class Customer360Module {}
