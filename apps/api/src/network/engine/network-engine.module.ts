import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { InfraModule } from '../infra/infra.module';
import { NetworkEngineService } from './network-engine.service';
import { NetworkEngineController } from './network-engine.controller';

/**
 * Motor de Red: el cerebro analítico del Gemelo Digital (grafo unificado,
 * presupuesto óptico, simulación de fallas y criticidad). Reutiliza la
 * instantánea de InfraService — no duplica el inventario.
 */
@Module({
  imports: [AuthModule, InfraModule],
  controllers: [NetworkEngineController],
  providers: [NetworkEngineService],
  exports: [NetworkEngineService],
})
export class NetworkEngineModule {}
