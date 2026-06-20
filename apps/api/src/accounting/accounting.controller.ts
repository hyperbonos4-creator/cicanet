import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountingService } from './accounting.service';
import { ReportsService } from './reports.service';
import { CrearAsientoDto, CrearCuentaDto, CrearTerceroDto } from './dto';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/**
 * Workspace contable. Acceso restringido al staff contable: admin y contador.
 * El operador y el técnico NO entran aquí.
 */
@Controller('accounting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly reports: ReportsService,
  ) {}

  // ---- Plan de cuentas ----
  @Get('cuentas')
  cuentas(@Query('q') q?: string, @Query('imputables') imputables?: string, @Query('clase') clase?: string) {
    return this.accounting.listCuentas({
      q,
      soloImputables: imputables === 'true',
      clase: clase ? parseInt(clase, 10) : undefined,
    });
  }

  @Post('cuentas')
  crearCuenta(@Body() dto: CrearCuentaDto) {
    return this.accounting.crearCuenta(dto);
  }

  // ---- Terceros ----
  @Get('terceros')
  terceros(@Query('q') q?: string) {
    return this.accounting.listTerceros(q);
  }

  @Post('terceros')
  crearTercero(@Body() dto: CrearTerceroDto) {
    return this.accounting.crearTercero(dto);
  }

  // ---- Periodos ----
  @Get('periodos')
  periodos() {
    return this.accounting.listPeriodos();
  }

  @Post('periodos/:periodo/cerrar')
  cerrar(@Param('periodo') periodo: string, @Req() req: Request) {
    return this.accounting.cerrarPeriodo(periodo, (req as any).user?.username);
  }

  @Post('periodos/:periodo/reabrir')
  @Roles('admin')
  reabrir(@Param('periodo') periodo: string) {
    return this.accounting.reabrirPeriodo(periodo);
  }

  // ---- Asientos ----
  @Get('asientos')
  asientos(@Query('periodo') periodo?: string, @Query('tipo') tipo?: string, @Query('estado') estado?: string) {
    return this.accounting.listAsientos({ periodo, tipo, estado });
  }

  @Get('asientos/:id')
  asiento(@Param('id') id: string) {
    return this.accounting.getAsiento(id);
  }

  @Post('asientos')
  crearAsiento(@Body() dto: CrearAsientoDto, @Req() req: Request) {
    return this.accounting.crearAsiento({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Post('asientos/:id/contabilizar')
  contabilizar(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.contabilizar(id, (req as any).user?.username);
  }

  @Post('asientos/:id/reversar')
  reversar(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.reversar(id, (req as any).user?.username);
  }

  // ---- Reportes ----
  @Get('reportes/dashboard')
  dashboard(@Query('periodo') periodo?: string) {
    return this.reports.dashboard(periodo || this.accounting.periodoDe(new Date()));
  }

  @Get('reportes/balance')
  balance(@Query('periodo') periodo?: string) {
    return this.reports.balanceComprobacion(periodo);
  }

  @Get('reportes/resultados')
  resultados(@Query('periodo') periodo?: string) {
    return this.reports.estadoResultados(periodo || this.accounting.periodoDe(new Date()));
  }

  @Get('reportes/balance-general')
  balanceGeneral(@Query('hasta') hasta?: string) {
    return this.reports.balanceGeneral(hasta || this.accounting.periodoDe(new Date()));
  }

  @Get('reportes/situacion-niif')
  situacionNiif(@Query('hasta') hasta?: string) {
    return this.reports.situacionFinancieraNiif(hasta || this.accounting.periodoDe(new Date()));
  }

  @Get('reportes/mayor')
  mayor(@Query('cuenta') cuenta: string, @Query('periodo') periodo?: string) {
    return this.reports.libroMayor(cuenta, periodo);
  }

  // ---- Exportables CSV (Excel) ----
  @Get('reportes/balance.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="balance-comprobacion.csv"')
  balanceCsv(@Query('periodo') periodo?: string) {
    return this.reports.balanceCsv(periodo);
  }

  @Get('reportes/libro-diario.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="libro-diario.csv"')
  libroDiarioCsv(@Query('periodo') periodo?: string) {
    return this.reports.libroDiarioCsv(periodo);
  }
}
