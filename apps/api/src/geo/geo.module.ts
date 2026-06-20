import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';
import { TilesController } from './tiles.controller';

@Module({
  imports: [AuthModule],
  controllers: [GeoController, TilesController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
