import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { InfraService } from './infra.service';
import { InfraController } from './infra.controller';
import { RolesGuard } from '../auth/guards';

@Module({
  imports: [AuthModule, GeoModule],
  controllers: [InfraController],
  providers: [InfraService, RolesGuard],
})
export class InfraModule {}
