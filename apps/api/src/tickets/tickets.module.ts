import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TicketsController } from './tickets.controller';
import { MyTicketsController } from './my-tickets.controller';
import { TicketsService } from './tickets.service';
import { RolesGuard } from '../auth/guards';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MyTicketsController, TicketsController],
  providers: [TicketsService, RolesGuard],
})
export class TicketsModule {}
