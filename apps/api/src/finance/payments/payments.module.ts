import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { PrismaModule } from '../../platform/prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WompiProvider } from './wompi.provider';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, WompiProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
