import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BankingService } from './banking.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Conciliación bancaria. Admin y contador. */
@Controller('banking')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @Get('cuentas')
  cuentas() {
    return this.banking.listCuentas();
  }

  @Post('cuentas')
  crearCuenta(@Body() body: { nombre: string; banco?: string; numero?: string; cuentaPuc: string }) {
    return this.banking.crearCuenta(body);
  }

  /** Importa un extracto CSV (texto plano en el body). */
  @Post('import')
  importar(@Body() body: { cuentaBancariaId: string; contenido: string }) {
    return this.banking.importarCsv(body.cuentaBancariaId, body.contenido);
  }

  @Get('sin-conciliar')
  sinConciliar(@Query('cuenta') cuenta?: string) {
    return this.banking.sinConciliar(cuenta);
  }

  @Get('resumen')
  resumen(@Query('cuenta') cuenta?: string) {
    return this.banking.resumen(cuenta);
  }

  @Get('movimientos/:id/sugerencias')
  sugerencias(@Param('id') id: string) {
    return this.banking.sugerencias(id);
  }

  @Post('movimientos/:id/conciliar')
  conciliar(@Param('id') id: string, @Body() body: { contrapartida?: string; matchPagoTxId?: string; descripcion?: string; terceroId?: string }, @Req() req: Request) {
    return this.banking.conciliar(id, body, (req as any).user?.username);
  }

  @Post('movimientos/:id/ignorar')
  ignorar(@Param('id') id: string) {
    return this.banking.ignorar(id);
  }
}
