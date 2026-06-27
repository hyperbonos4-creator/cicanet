import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { RolesGuard } from '../../platform/auth/guards';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SupportController],
  providers: [SupportService, RolesGuard],
  exports: [SupportService],
})
export class SupportModule {}
