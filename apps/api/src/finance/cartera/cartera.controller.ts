import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CarteraService, type CrearAcuerdoInput } from './cartera.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/**
 * Cartera avanzada (cobranza "de guerra"): acuerdos de pago / refinanciación y
 * castigo de cartera incobrable. Admin y contador (operador puede consultar).
 */
@Controller('cartera')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador', 'contador')
export class CarteraController {
  constructor(private readonly cartera: CarteraService) {}

  @Get('acuerdos')
  listAcuerdos(@Query('estado') estado?: string, @Query('clienteId') clienteId?: string) {
    return this.cartera.listAcuerdos({ estado, clienteId });
  }

  @Get('acuerdos/:id')
  getAcuerdo(@Param('id') id: string) {
    return this.cartera.getAcuerdo(id);
  }

  @Post('acuerdos')
  @Roles('admin', 'contador')
  crearAcuerdo(@Body() dto: CrearAcuerdoInput, @Req() req: Request) {
    return this.cartera.crearAcuerdo({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Post('acuerdos/:id/cuota')
  @Roles('admin', 'contador')
  marcarCuota(@Param('id') id: string, @Body() body: { n: number; pagada?: boolean }) {
    return this.cartera.marcarCuota(id, body.n, body.pagada !== false);
  }

  @Post('acuerdos/:id/estado')
  @Roles('admin', 'contador')
  cambiarEstado(@Param('id') id: string, @Body() body: { estado: string }) {
    return this.cartera.cambiarEstado(id, body.estado);
  }

  @Post('castigar')
  @Roles('admin', 'contador')
  castigar(
    @Body() body: { clienteId: string; monto: number; concepto?: string; facturaIds?: string[] },
    @Req() req: Request,
  ) {
    return this.cartera.castigar({ ...body, actor: (req as any).user?.username });
  }
}
