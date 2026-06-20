import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CashService, type CrearReciboInput, type AplicacionInput } from './cash.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Recibos de caja / aplicación de pagos (cash application). Admin/operador/contador. */
@Controller('cash')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador', 'contador')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('recibos')
  list(@Query('estado') estado?: string, @Query('clienteId') clienteId?: string) {
    return this.cash.list({ estado, clienteId });
  }

  @Get('resumen')
  resumen() {
    return this.cash.resumen();
  }

  @Get('cliente/:id/facturas')
  facturas(@Param('id') id: string) {
    return this.cash.facturasPendientes(id);
  }

  @Get('recibos/:id')
  getOne(@Param('id') id: string) {
    return this.cash.getOne(id);
  }

  @Post('recibos')
  crear(@Body() dto: CrearReciboInput, @Req() req: Request) {
    return this.cash.crear({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Post('recibos/:id/aplicar')
  aplicar(@Param('id') id: string, @Body() body: { aplicaciones: AplicacionInput[] }, @Req() req: Request) {
    return this.cash.aplicarSaldo(id, body.aplicaciones ?? [], (req as any).user?.username);
  }

  @Post('recibos/:id/identificar')
  identificar(@Param('id') id: string, @Body() body: { clienteId: string; aplicaciones?: AplicacionInput[] }, @Req() req: Request) {
    return this.cash.identificar(id, body.clienteId, body.aplicaciones ?? [], (req as any).user?.username);
  }

  @Post('recibos/:id/anular')
  @Roles('admin', 'contador')
  anular(@Param('id') id: string, @Req() req: Request) {
    return this.cash.anular(id, (req as any).user?.username);
  }
}
