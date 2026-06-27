import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { GeoModule } from '../../network/geo/geo.module';
import { NetworkModule } from '../../network/topology/network.module';
import { PaymentsModule } from '../../finance/payments/payments.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SupportModule } from '../../operations/support/support.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { MeModule } from '../../crm/me/me.module';
import { InfraModule } from '../../network/infra/infra.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AgentToolsService } from './agent-tools.service';
import { ProjectExplorerService } from './project-explorer.service';
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
    InfraModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService, AgentToolsService, ProjectExplorerService, LlmProvider],
  exports: [AssistantService],
})
export class AssistantModule {}
