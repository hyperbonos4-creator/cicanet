import { Controller, Get, Logger, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { config } from '../config';

/**
 * Proxy de teselas (tiles) de imagen satelital.
 *
 * Las teselas las pide el navegador (MapLibre) SIN cabecera de autenticación,
 * por eso este controlador es público (no lleva JwtAuthGuard). Solo expone
 * imagen satelital pública; el token de Mapbox vive en el servidor y NUNCA se
 * entrega al cliente (la web apunta a `/api/tiles/satellite/{z}/{x}/{y}`).
 *
 * Usa Mapbox Satellite @2x (512 px, "retina") que llega hasta z22 — bastante
 * más nítido que la ortofoto base. Si no hay token configurado responde 404.
 */
@Controller('tiles')
export class TilesController {
  private readonly logger = new Logger('TilesController');

  @Get('satellite/:z/:x/:y')
  async satellite(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: Response,
  ): Promise<void> {
    const token = config.geo.mapboxToken;
    if (!token) {
      res.status(404).end();
      return;
    }

    // Normaliza "12.jpg" -> "12" por si MapLibre añade extensión.
    const Z = String(z).replace(/\D.*$/, '');
    const X = String(x).replace(/\D.*$/, '');
    const Y = String(y).replace(/\D.*$/, '');

    const url =
      `https://api.mapbox.com/v4/mapbox.satellite/${Z}/${X}/${Y}@2x.jpg90` +
      `?access_token=${encodeURIComponent(token)}`;

    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!upstream.ok) {
        // Fuera de cobertura/zoom: 204 para que MapLibre no muestre error.
        res.status(upstream.status === 404 ? 204 : upstream.status).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 días
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(buf);
    } catch (e: any) {
      this.logger.warn(`Tile satélite ${Z}/${X}/${Y} falló: ${e.message}`);
      res.status(204).end();
    }
  }

  /**
   * Proxy de imagen Street View (Static API). La clave de Google vive en el
   * servidor y NUNCA se entrega al cliente. La web pide
   * `/api/tiles/streetview?lat=&lng=&heading=&pitch=&fov=` dentro de un <img>.
   * scale=2 → imagen "retina" (más nítida). Cobra por request (la cuenta de
   * Google tiene billing); por eso el botón solo se muestra cuando metadata
   * confirma que hay panorámica.
   */
  @Get('streetview')
  async streetview(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('heading') heading: string,
    @Query('pitch') pitch: string,
    @Query('fov') fov: string,
    @Res() res: Response,
  ): Promise<void> {
    const key = config.geo.googleKey;
    if (!key || !lat || !lng) {
      res.status(404).end();
      return;
    }
    const h = clampNum(heading, 0, 360, 0);
    const p = clampNum(pitch, -90, 90, 0);
    const f = clampNum(fov, 10, 120, 90);
    const url =
      `https://maps.googleapis.com/maps/api/streetview` +
      `?size=640x400&scale=2&source=outdoor` +
      `&location=${encodeURIComponent(lat)},${encodeURIComponent(lng)}` +
      `&heading=${h}&pitch=${p}&fov=${f}` +
      `&key=${encodeURIComponent(key)}`;
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!upstream.ok) {
        res.status(upstream.status === 404 ? 204 : upstream.status).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(buf);
    } catch (e: any) {
      this.logger.warn(`Street View ${lat},${lng} falló: ${e.message}`);
      res.status(204).end();
    }
  }
}

/** Convierte a número y lo acota a [min,max]; usa def si no es válido. */
function clampNum(v: string, min: number, max: number, def: number): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
