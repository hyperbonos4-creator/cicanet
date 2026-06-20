import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { NetworkModule } from '../network/network.module';
import { PaymentsModule } from '../payments/payments.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SupportModule } from '../support/support.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MeModule } from '../me/me.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AgentToolsService } from './agent-tools.service';
import { LlmProvider } from './llm.provider';

@Module({
  imports: [
    AuthModule,
    GeoModule,
    NetworkModule,
    PaymentsModule,
    WhatsappModule,
    SupportModule,
    PrismaModule,
    MeModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService, AgentToolsService, LlmProvider],
  exports: [AssistantService],
})
export class AssistantModule {}
