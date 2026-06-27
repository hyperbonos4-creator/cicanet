import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { DianService } from './dian.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Centro DIAN unificado (FE, notas, doc. soporte, nómina, exógena). Admin y contador. */
@Controller('dian')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class DianController {
  constructor(private readonly dian: DianService) {}

  @Get('centro')
  centro() {
    return this.dian.centro();
  }

  @Get('config')
  getConfig() {
    return this.dian.getConfig();
  }

  @Post('config')
  @Roles('admin')
  setConfig(@Body() body: Record<string, any>) {
    return this.dian.setConfig(body);
  }

  @Get('documentos')
  documentos(@Query('tipo') tipo?: string, @Query('estado') estado?: string) {
    return this.dian.listDocumentos({ tipo, estado });
  }

  @Post('documentos/:id/reprocesar')
  @Roles('admin')
  reprocesar(@Param('id') id: string) {
    return this.dian.reprocesar(id);
  }

  // ---- Motor de mapeo exógena ----
  @Get('exogena/reglas')
  reglas(@Query('formato') formato?: string) {
    return this.dian.listReglas(formato);
  }

  @Post('exogena/reglas')
  @Roles('admin', 'contador')
  upsertRegla(@Body() body: { formato: string; cuentaPatron: string; concepto: string; descripcion?: string; activa?: boolean }) {
    return this.dian.upsertRegla(body);
  }

  @Get('exogena/validacion')
  validacion(@Query('anio') anio?: string) {
    return this.dian.validacion(anio ? parseInt(anio, 10) : new Date().getFullYear());
  }
}
