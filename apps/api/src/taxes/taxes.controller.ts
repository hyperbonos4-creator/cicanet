import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { TaxesService, type CalculoInput } from './taxes.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Motor de impuestos (reglas IVA/retenciones). Admin y contador. */
@Controller('taxes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get('reglas')
  reglas(@Query('tipo') tipo?: string) {
    return this.taxes.list(tipo);
  }

  @Post('reglas')
  @Roles('admin')
  upsert(@Body() body: { codigo: string; tipo: string; nombre: string; porcentaje: number; baseMinima?: number; cuentaPuc: string; activa?: boolean }) {
    return this.taxes.upsert(body);
  }

  @Post('calcular')
  calcular(@Body() body: CalculoInput) {
    return this.taxes.calcular(body);
  }
}
