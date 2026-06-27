import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { ClientesModule } from '../clientes/clientes.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { RolesGuard } from '../../platform/auth/guards';

@Module({
  imports: [AuthModule, PrismaModule, ClientesModule],
  controllers: [MeController],
  providers: [MeService, RolesGuard],
  exports: [MeService],
})
export class MeModule {}
