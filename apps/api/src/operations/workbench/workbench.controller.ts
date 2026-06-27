import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WorkbenchService } from './workbench.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Bandeja de pendientes + centro de control financiero. Admin y contador. */
@Controller('workbench')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  @Get()
  resumen() {
    return this.workbench.resumen();
  }

  /** Centro de control: alertas por excepción + indicadores de salud + calendario tributario. */
  @Get('salud')
  salud(@Query('periodo') periodo?: string) {
    return this.workbench.salud(periodo);
  }
}
