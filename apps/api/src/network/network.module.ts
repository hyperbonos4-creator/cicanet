import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { InfraModule } from '../infra/infra.module';
import { NetworkService } from './network.service';
import { NetworkController } from './network.controller';
import { NetworkGateway } from './network.gateway';
import { RolesGuard } from '../auth/guards';

@Module({
  imports: [AuthModule, GeoModule, InfraModule],
  controllers: [NetworkController],
  providers: [NetworkService, NetworkGateway, RolesGuard],
  exports: [NetworkService],
})
export class NetworkModule {}
