import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { NetworkEngineService } from './network-engine.service';
import { JwtAuthGuard } from '../../platform/auth/guards';
import type { Wavelength } from '../infra/domain/optical';

/**
 * Motor de Red (Network Engine). Endpoints de análisis del Gemelo Digital:
 * presupuesto óptico, simulación de fallas, criticidad y caminos. Solo lectura
 * (no muta la planta), por eso basta con autenticación.
 */
@Controller('engine')
@UseGuards(JwtAuthGuard)
export class NetworkEngineController {
  constructor(private readonly engine: NetworkEngineService) {}

  /** Resumen del modelo: nodos, aristas, islas y planta huérfana (sin raíz). */
  @Get('overview')
  overview() {
    return this.engine.overview();
  }

  /** Ranking de criticidad (SPOF): activos cuya falla afecta a más clientes. */
  @Get('criticality')
  criticality(@Query('limit') limit?: string) {
    return this.engine.criticality(limit ? parseInt(limit, 10) : undefined);
  }

  /** Simula la caída de un activo y devuelve el impacto aguas abajo. */
  @Get('simulate/failure/:id')
  simulateFailure(@Param('id') id: string) {
    return this.engine.simulateFailure(id);
  }

  /** Presupuesto óptico (dB) del activo hacia su raíz (OLT/POP). */
  @Get('optical/:id')
  optical(
    @Param('id') id: string,
    @Query('tx') tx?: string,
    @Query('rx') rx?: string,
    @Query('nm') nm?: string,
  ) {
    return this.engine.opticalBudget(id, {
      txPowerDbm: tx != null ? parseFloat(tx) : undefined,
      rxSensitivityDbm: rx != null ? parseFloat(rx) : undefined,
      wavelength: nm != null ? (parseInt(nm, 10) as Wavelength) : undefined,
    });
  }

  /** Cadena de dependencia de un activo hacia la raíz. */
  @Get('dependencies/:id')
  dependencies(@Param('id') id: string) {
    return this.engine.dependencies(id);
  }

  /** Camino más corto (ponderado por fibra) entre dos activos. */
  @Get('path')
  path(@Query('from') from: string, @Query('to') to: string) {
    return this.engine.path(from, to);
  }
}
