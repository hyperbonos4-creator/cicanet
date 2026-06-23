import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DemoService } from './demo.service';
import { DemoController } from './demo.controller';

/** Demo público efímero (VISIONYX Telecom). Reúsa UsersService para crear/barrer. */
@Module({
  imports: [UsersModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
