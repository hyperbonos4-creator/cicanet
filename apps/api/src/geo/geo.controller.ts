import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsLatitude, IsLongitude, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { GeoService } from './geo.service';
import { JwtAuthGuard } from '../auth/guards';

class GeocodeDto {
  @IsString()
  @MinLength(3)
  q: string;
}

class ReverseDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}

/** Geocodificación e IP-geolocalización. Requiere sesión (JWT). */
@Controller('geo')
@UseGuards(JwtAuthGuard)
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Geolocaliza por la IP del cliente que hace la petición. */
  @Get('ip')
  ip(@Req() req: Request) {
    const ip = extractIp(req);
    return this.geo.locateByIp(ip);
  }

  /** Dirección -> coordenadas (candidatos reales de OpenStreetMap). */
  @Post('geocode')
  geocode(@Body() dto: GeocodeDto) {
    return this.geo.geocode(dto.q);
  }

  /** Coordenadas -> dirección legible. */
  @Post('reverse')
  async reverse(@Body() dto: ReverseDto) {
    const direccion = await this.geo.reverse(dto.lat, dto.lng);
    return { direccion };
  }

  /** ¿Hay Street View cerca de este punto? (metadata gratuita de Google). */
  @Get('streetview')
  streetview(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.geo.streetViewMeta(parseFloat(lat), parseFloat(lng));
  }

  /** Atajo GET para geocodificar desde la barra de búsqueda. */
  @Get('geocode')
  geocodeQuery(@Query('q') q: string) {
    return this.geo.geocode(q || '');
  }
}

/** Obtiene la IP real del cliente, respetando proxies (X-Forwarded-For). */
function extractIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}
