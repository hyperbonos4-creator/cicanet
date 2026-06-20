import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Facturación recurrente por ciclo. Admin y contador. La corrida real solo admin. */
@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('config')
  getConfig() {
    return this.billing.getConfig();
  }

  @Post('config')
  @Roles('admin')
  setConfig(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.billing.setConfig(body, (req as any).user?.username);
  }

  @Get('preview')
  preview(@Query('periodo') periodo: string) {
    return this.billing.preview(periodo);
  }

  @Post('run')
  @Roles('admin')
  run(@Body() body: { periodo: string; dryRun?: boolean }, @Req() req: Request) {
    return this.billing.run(body.periodo, { dryRun: body.dryRun, emitidoPor: (req as any).user?.username });
  }

  @Post('suspender-morosos')
  @Roles('admin')
  suspender(@Body() body: { diasGracia?: number; aplicar?: boolean }) {
    return this.billing.suspenderMorosos({ diasGracia: body.diasGracia, aplicar: body.aplicar });
  }

  // ---- Cargos recurrentes (IP fija, TV, arriendo, descuentos…) ----
  @Get('cargos')
  listCargos(@Query('servicioId') servicioId: string) {
    return this.billing.listCargos(servicioId);
  }

  @Post('cargos')
  @Roles('admin')
  crearCargo(@Body() body: { servicioId: string; concepto: string; monto: number; cuentaIngreso?: string; ivaPct?: number }) {
    return this.billing.crearCargo(body);
  }

  @Post('cargos/:id/toggle')
  @Roles('admin')
  toggleCargo(@Param('id') id: string, @Body() body: { activo: boolean }) {
    return this.billing.toggleCargo(id, body.activo);
  }

  @Delete('cargos/:id')
  @Roles('admin')
  eliminarCargo(@Param('id') id: string) {
    return this.billing.eliminarCargo(id);
  }
}
