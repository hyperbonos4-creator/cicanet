import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { TicketsController } from './tickets.controller';
import { MyTicketsController } from './my-tickets.controller';
import { TicketsService } from './tickets.service';
import { RolesGuard } from '../../platform/auth/guards';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MyTicketsController, TicketsController],
  providers: [TicketsService, RolesGuard],
})
export class TicketsModule {}
