import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Analítica vertical de ISP + centros de costo. Admin y contador. */
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  private periodoActual() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // ---- Centros de costo ----
  @Get('centros')
  centros() {
    return this.analytics.listCentros();
  }

  @Post('centros')
  @Roles('admin', 'contador')
  upsertCentro(@Body() body: { codigo: string; nombre: string; tipo?: string; padreCodigo?: string; activo?: boolean }) {
    return this.analytics.upsertCentro(body);
  }

  // ---- Reportes verticales ----
  @Get('ingreso-por-barrio')
  ingresoPorBarrio(@Query('periodo') periodo?: string) {
    return this.analytics.ingresoPorBarrio(periodo || this.periodoActual());
  }

  @Get('cartera-por-nap')
  carteraPorNap() {
    return this.analytics.carteraPorNap();
  }

  @Get('mora-por-plan')
  moraPorPlan() {
    return this.analytics.moraPorPlan();
  }

  @Get('recaudo-por-canal')
  recaudoPorCanal(@Query('periodo') periodo?: string) {
    return this.analytics.recaudoPorCanal(periodo);
  }

  @Get('arpu-por-zona')
  arpuPorZona(@Query('periodo') periodo?: string) {
    return this.analytics.arpuPorZona(periodo || this.periodoActual());
  }

  @Get('rentabilidad-por-centro')
  rentabilidadPorCentro(@Query('periodo') periodo?: string) {
    return this.analytics.rentabilidadPorCentro(periodo || this.periodoActual());
  }

  @Get('churn-por-mora')
  churnPorMora() {
    return this.analytics.churnPorMora();
  }
}
