import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PayablesService, type CrearCompraInput } from './payables.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Cuentas por pagar (compras/gastos). Admin y contador. */
@Controller('payables')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  list(@Query('estado') estado?: string, @Query('proveedorId') proveedorId?: string) {
    return this.payables.list({ estado, proveedorId });
  }

  @Get('resumen')
  resumen() {
    return this.payables.resumen();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.payables.getOne(id);
  }

  @Post()
  crear(@Body() dto: CrearCompraInput, @Req() req: Request) {
    return this.payables.crear({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Post(':id/pagar')
  pagar(@Param('id') id: string, @Body() body: { cuentaBanco?: string; fecha?: string }, @Req() req: Request) {
    return this.payables.pagar(id, body, (req as any).user?.username);
  }

  @Post(':id/programar-pago')
  programarPago(@Param('id') id: string, @Body() body: { fecha: string }) {
    return this.payables.programarPago(id, body.fecha);
  }

  @Post(':id/anular')
  @Roles('admin', 'contador')
  anular(@Param('id') id: string, @Req() req: Request) {
    return this.payables.anular(id, (req as any).user?.username);
  }
}
