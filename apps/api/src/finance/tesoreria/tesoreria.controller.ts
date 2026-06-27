import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TesoreriaService, type EgresoInput, type TrasladoInput, type ComisionInput, type AnticipoInput, type LegalizarInput } from './tesoreria.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Tesorería: egresos, traslados, comisiones, saldos y flujo de caja. Admin/contador. */
@Controller('tesoreria')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class TesoreriaController {
  constructor(private readonly tesoreria: TesoreriaService) {}

  @Get('movimientos')
  list(@Query('tipo') tipo?: string) {
    return this.tesoreria.list(tipo);
  }

  @Get('saldos')
  saldos() {
    return this.tesoreria.saldos();
  }

  @Get('flujo-caja')
  flujo() {
    return this.tesoreria.flujoCaja();
  }

  @Post('egreso')
  egreso(@Body() dto: EgresoInput, @Req() req: Request) {
    return this.tesoreria.egreso(dto, (req as any).user?.username);
  }

  @Post('traslado')
  traslado(@Body() dto: TrasladoInput, @Req() req: Request) {
    return this.tesoreria.traslado(dto, (req as any).user?.username);
  }

  @Post('comision')
  comision(@Body() dto: ComisionInput, @Req() req: Request) {
    return this.tesoreria.comision(dto, (req as any).user?.username);
  }

  @Post('anticipo')
  anticipo(@Body() dto: AnticipoInput, @Req() req: Request) {
    return this.tesoreria.anticipo(dto, (req as any).user?.username);
  }

  @Post('legalizar')
  legalizar(@Body() dto: LegalizarInput, @Req() req: Request) {
    return this.tesoreria.legalizar(dto, (req as any).user?.username);
  }
}
