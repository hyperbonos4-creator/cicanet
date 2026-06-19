import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  imports: [AuthModule],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
