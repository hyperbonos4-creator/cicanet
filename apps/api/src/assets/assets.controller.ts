import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AssetsService } from './assets.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Activos fijos y depreciación. Admin y contador. */
@Controller('assets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list() {
    return this.assets.list();
  }

  @Post()
  crear(@Body() body: { nombre: string; valorAdquisicion: number; vidaUtilMeses: number; fechaAdquisicion?: string; valorResidual?: number }) {
    return this.assets.crear(body);
  }

  @Get('depreciacion/preview')
  preview(@Query('periodo') periodo: string) {
    return this.assets.preview(periodo);
  }

  @Post('depreciacion/run')
  @Roles('admin')
  run(@Body() body: { periodo: string; dryRun?: boolean }, @Req() req: Request) {
    return this.assets.run(body.periodo, { dryRun: body.dryRun, actor: (req as any).user?.username });
  }
}
