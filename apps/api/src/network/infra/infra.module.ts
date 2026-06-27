import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { InfraService } from './infra.service';
import { InfraController } from './infra.controller';
import { RolesGuard } from '../../platform/auth/guards';

@Module({
  imports: [AuthModule, GeoModule],
  controllers: [InfraController],
  providers: [InfraService, RolesGuard],
  exports: [InfraService],
})
export class InfraModule {}
