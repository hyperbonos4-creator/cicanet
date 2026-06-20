import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ExogenaService } from './exogena.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Información exógena (medios magnéticos DIAN). Admin y contador. */
@Controller('exogena')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class ExogenaController {
  constructor(private readonly exogena: ExogenaService) {}

  @Get('formatos')
  formatos() {
    return this.exogena.formatos();
  }

  @Get(':formato')
  generar(@Param('formato') formato: string, @Query('anio') anio?: string) {
    return this.exogena.generar(formato, anio ? parseInt(anio, 10) : new Date().getFullYear());
  }

  @Get(':formato/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="exogena.csv"')
  csv(@Param('formato') formato: string, @Query('anio') anio?: string) {
    return this.exogena.csv(formato, anio ? parseInt(anio, 10) : new Date().getFullYear());
  }
}
