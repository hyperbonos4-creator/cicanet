import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { NetworkService } from './network.service';
import { GeoService } from '../geo/geo.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

class CoverageCheckDto {
  @IsNumber()
  lng: number;

  @IsNumber()
  lat: number;
}

class CreateNapDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsIn(['NAP', 'CTO'])
  tipo?: 'NAP' | 'CTO';

  // Coordenada exacta (si ya viene geocodificada desde el panel).
  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  lat?: number;

  // Alternativa: dirección a geocodificar en el servidor.
  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(256)
  puertos_total?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(256)
  puertos_usados?: number;
}

class CreateZoneDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  // Polígono de la zona: arreglo de pares [lng, lat].
  @IsArray()
  puntos: number[][];
}

/** Todos los endpoints de red exigen sesión (JWT). El mapa NO es público. */
@Controller('network')
@UseGuards(JwtAuthGuard)
export class NetworkController {
  constructor(
    private readonly net: NetworkService,
    private readonly geo: GeoService,
  ) {}

  @Get('meta')
  meta() {
    return this.net.getMeta();
  }

  @Get('bundle')
  bundle() {
    // Un solo request para pintar el mapa completo.
    return {
      meta: this.net.getMeta(),
      comuna1: this.net.getComuna1(),
      sector: this.net.getSector(),
      coverage: this.net.getCoverage(),
      fiber: this.net.getFiber(),
      nodes: this.net.getNodes(),
      clients: this.net.getClients(),
      zones: this.net.getZones(),
      stats: this.net.getStats(),
    };
  }

  @Get('nodes')
  nodes() {
    return this.net.getNodes();
  }

  @Get('stats')
  stats() {
    return this.net.getStats();
  }

  @Post('coverage/check')
  checkCoverage(@Body() dto: CoverageCheckDto) {
    return this.net.checkCoverage(dto.lng, dto.lat);
  }

  // ---- Infraestructura: gestión de NAP (admin / operador) ----

  @Get('naps')
  listNaps() {
    return this.net.listNaps();
  }

  @Post('naps')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  async createNap(@Body() dto: CreateNapDto, @Req() req: Request) {
    let { lng, lat } = dto;
    let direccion = dto.direccion;

    // Si no hay coordenada, se geocodifica la dirección en el servidor.
    if ((typeof lng !== 'number' || typeof lat !== 'number') && direccion) {
      const candidatos = await this.geo.geocode(direccion);
      const dentro = candidatos.find((c) => c.dentroDelBarrio) || candidatos[0];
      if (!dentro) {
        throw new BadRequestException(
          'No se encontró esa dirección. Verifícala o ubica el punto en el mapa.',
        );
      }
      lng = dentro.lng;
      lat = dentro.lat;
      direccion = dentro.displayName;
    }

    if (typeof lng !== 'number' || typeof lat !== 'number') {
      throw new BadRequestException(
        'Debes indicar una dirección o una coordenada (lng, lat).',
      );
    }

    const user = (req as any).user;
    return this.net.addNap({
      nombre: dto.nombre,
      tipo: dto.tipo,
      lng,
      lat,
      puertos_total: dto.puertos_total,
      puertos_usados: dto.puertos_usados,
      direccion,
      creadoPor: user?.username,
    });
  }

  @Delete('naps/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  deleteNap(@Param('id') id: string) {
    return this.net.deleteNap(id);
  }

  // ---- Infraestructura: zonas de cobertura dibujadas (admin / operador) ----

  @Get('zones')
  listZones() {
    return this.net.listZones();
  }

  @Post('zones')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  createZone(@Body() dto: CreateZoneDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.net.addZone({
      nombre: dto.nombre,
      puntos: dto.puntos,
      creadoPor: user?.username,
    });
  }

  @Delete('zones/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  deleteZone(@Param('id') id: string) {
    return this.net.deleteZone(id);
  }
}
