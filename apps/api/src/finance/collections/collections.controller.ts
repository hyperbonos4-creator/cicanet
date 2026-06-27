import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/**
 * Cartera / cobranza. Lectura para staff que gestiona recaudo: admin, operador
 * y contador. El técnico y el cliente no acceden.
 */
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador', 'contador')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('aging')
  aging(@Query('barrio') barrio?: string, @Query('nap') nap?: string, @Query('soloVencidos') soloVencidos?: string) {
    return this.collections.aging({ barrio, nap, soloVencidos: soloVencidos === 'true' });
  }

  @Get('aging/por-zona')
  porZona(@Query('dim') dim?: string) {
    const d = (dim === 'comuna' || dim === 'nap' ? dim : 'barrio') as 'barrio' | 'comuna' | 'nap';
    return this.collections.agingPorDimension(d);
  }

  @Get('resumen')
  resumen() {
    return this.collections.resumen();
  }

  @Get('cliente/:id')
  cliente(@Param('id') id: string) {
    return this.collections.carteraCliente(id);
  }
}
