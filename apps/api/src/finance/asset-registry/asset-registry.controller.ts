import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AssetRegistryService, type CrearAssetInput } from './asset-registry.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Inventario operativo de red (seriales/comodato/stock). Admin/operador/técnico/contador. */
@Controller('asset-registry')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador', 'tecnico', 'contador')
export class AssetRegistryController {
  constructor(private readonly assets: AssetRegistryService) {}

  @Get()
  list(@Query('estado') estado?: string, @Query('categoria') categoria?: string, @Query('servicioId') servicioId?: string, @Query('q') q?: string) {
    return this.assets.list({ estado, categoria, servicioId, q });
  }

  @Get('resumen')
  resumen() {
    return this.assets.resumen();
  }

  @Post()
  @Roles('admin', 'operador')
  crear(@Body() dto: CrearAssetInput, @Req() req: Request) {
    return this.assets.crear({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Post(':id/asignar')
  @Roles('admin', 'operador', 'tecnico')
  asignar(@Param('id') id: string, @Body() body: { servicioId?: string; clienteId?: string; napId?: string; comodato?: boolean; ubicacion?: string }) {
    return this.assets.asignar(id, body);
  }

  @Post(':id/liberar')
  @Roles('admin', 'operador', 'tecnico')
  liberar(@Param('id') id: string) {
    return this.assets.liberar(id);
  }

  @Post(':id/estado')
  @Roles('admin', 'operador')
  cambiarEstado(@Param('id') id: string, @Body() body: { estado: string }) {
    return this.assets.cambiarEstado(id, body.estado);
  }

  @Post(':id/vincular-contable')
  @Roles('admin', 'contador')
  vincular(@Param('id') id: string, @Body() body: { activoFijoId: string }) {
    return this.assets.vincularContable(id, body.activoFijoId);
  }
}
