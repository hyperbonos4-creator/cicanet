import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { SupportModule } from '../../operations/support/support.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { HandoffService } from './handoff.service';
import { RolesGuard } from '../../platform/auth/guards';

@Module({
  imports: [AuthModule, PrismaModule, SupportModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, HandoffService, RolesGuard],
  exports: [WhatsappService, HandoffService],
})
export class WhatsappModule {}
