import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkbenchService } from './workbench.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Bandeja de pendientes del contador. Admin y contador. */
@Controller('workbench')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  @Get()
  resumen() {
    return this.workbench.resumen();
  }
}
