import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PresupuestoService } from './presupuesto.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Control presupuestal (Presupuesto vs Real). Admin y contador. */
@Controller('presupuesto')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class PresupuestoController {
  constructor(private readonly presupuesto: PresupuestoService) {}

  @Get()
  list(@Query('anio') anio?: string) {
    return this.presupuesto.list(anio ? parseInt(anio, 10) : new Date().getFullYear());
  }

  @Get('ejecucion')
  ejecucion(@Query('anio') anio?: string, @Query('periodo') periodo?: string) {
    return this.presupuesto.ejecucion(anio ? parseInt(anio, 10) : new Date().getFullYear(), periodo);
  }

  @Post()
  upsert(
    @Body() body: { anio: number; periodo?: string | null; cuentaCodigo: string; centroCosto?: string | null; monto: number; notas?: string },
    @Req() req: Request,
  ) {
    return this.presupuesto.upsert({ ...body, creadoPor: (req as any).user?.username });
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.presupuesto.eliminar(id);
  }
}
