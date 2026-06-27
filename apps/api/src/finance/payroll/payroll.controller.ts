import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Nómina (liquidación + contabilización). Admin y contador. */
@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('config')
  getConfig() {
    return this.payroll.getConfig();
  }

  @Post('config')
  @Roles('admin')
  setConfig(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.payroll.setConfig(body, (req as any).user?.username);
  }

  @Get('empleados')
  empleados() {
    return this.payroll.listEmpleados();
  }

  @Post('empleados')
  crearEmpleado(@Body() body: { nombre: string; documento: string; cargo?: string; salarioBase: number; fechaIngreso?: string; email?: string }) {
    return this.payroll.crearEmpleado(body);
  }

  @Get('liquidaciones')
  liquidaciones(@Query('periodo') periodo?: string) {
    return this.payroll.listLiquidaciones(periodo);
  }

  @Get('preview')
  preview(@Query('periodo') periodo: string) {
    return this.payroll.preview(periodo);
  }

  @Post('run')
  @Roles('admin')
  run(@Body() body: { periodo: string; dryRun?: boolean; novedades?: any[] }, @Req() req: Request) {
    return this.payroll.run(body.periodo, { dryRun: body.dryRun, actor: (req as any).user?.username, novedades: body.novedades });
  }
}
