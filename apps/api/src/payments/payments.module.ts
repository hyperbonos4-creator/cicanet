import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
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
