import { Controller, Get, Logger, Param, Query, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as https from 'node:https';
import { resolve } from 'node:path';
import type { Response } from 'express';
import { config } from '../config';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://portalidem.metropol.gov.co/',
  Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9',
};

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
  /** Caché en disco de la ortofoto de Medellín (independencia del servidor municipal). */
  private readonly medellinCacheDir = resolve(process.cwd(), config.geo.dataDir, 'tiles', 'medellin');
  private readonly catastroCacheDir = resolve(process.cwd(), config.geo.dataDir, 'tiles', 'catastro');

  /**
   * Ortofoto oficial de Medellín 2024 (GeoMedellín, Creative Commons) con CACHÉ.
   * La 1ª vez baja la tesela del servidor municipal (con cabeceras de navegador,
   * que su WAF exige) y la guarda en disco; las siguientes se sirven desde el
   * disco. Así CICANET NO depende de la disponibilidad del servidor de Medellín.
   * Ruta {z}/{y}/{x} = nivel/fila/columna (orden ArcGIS), que es justo lo que
   * MapLibre envía con el template `/tiles/medellin/{z}/{y}/{x}`.
   */
  @Get('medellin/:z/:y/:x')
  async medellin(
    @Param('z') z: string,
    @Param('y') y: string,
    @Param('x') x: string,
    @Res() res: Response,
  ): Promise<void> {
    // Validación estricta (solo enteros) para evitar path traversal.
    if (![z, y, x].every((v) => /^\d+$/.test(v))) {
      res.status(400).end();
      return;
    }

    const dir = resolve(this.medellinCacheDir, z, y);
    const file = resolve(dir, `${x}.jpg`);

    // 1) Servir desde caché si ya existe.
    if (existsSync(file)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 días
      res.setHeader('X-Tile-Cache', 'HIT');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(readFileSync(file));
      return;
    }

    // 2) Descargar del servidor municipal con cabeceras de navegador (su WAF las exige).
    const url = config.geo.medellinTilesUrl
      .replace('{z}', z)
      .replace('{y}', y)
      .replace('{x}', x);
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: 'https://www.medellin.gov.co/',
          Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
          'Accept-Language': 'es-CO,es;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) {
        res.status(204).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      // Guardar en caché (best-effort; si falla, igual servimos la imagen).
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file, buf);
      } catch (e: any) {
        this.logger.warn(`No se pudo cachear ${z}/${y}/${x}: ${e.message}`);
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.setHeader('X-Tile-Cache', 'MISS');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(buf);
    } catch (e: any) {
      this.logger.warn(`Ortofoto Medellín ${z}/${y}/${x} falló: ${e.message}`);
      res.status(204).end();
    }
  }

  /**
   * Overlay de catastro AMVA (predios/manzanas/construcciones) por municipio,
   * con CACHÉ por bbox. La 1ª vez pide el `export` al servidor del AMVA (con
   * cabeceras de navegador) y lo guarda; luego se sirve del disco. Independiente
   * del servidor del AMVA tras la primera carga de cada vista.
   * MapLibre pide `/tiles/catastro/:muni?bbox={bbox-epsg-3857}`.
   */
  @Get('catastro/:muni')
  async catastro(
    @Param('muni') muni: string,
    @Query('bbox') bbox: string,
    @Res() res: Response,
  ): Promise<void> {
    const base = config.geo.catastro[muni];
    // bbox = "minx,miny,maxx,maxy" en EPSG:3857 (4 números, admite signo/decimal).
    if (!base || !bbox || !/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(bbox)) {
      res.status(400).end();
      return;
    }

    const key = createHash('sha1').update(bbox).digest('hex');
    const dir = resolve(this.catastroCacheDir, muni);
    const file = resolve(dir, `${key}.png`);

    if (existsSync(file)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.setHeader('X-Tile-Cache', 'HIT');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(readFileSync(file));
      return;
    }

    const url =
      `${base}?bbox=${encodeURIComponent(bbox)}` +
      `&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&dpi=96&f=image`;
    try {
      // El servidor del AMVA presenta una cadena TLS incompleta que Alpine
      // rechaza; relajamos la verificación SOLO para esta fuente pública de
      // solo lectura (no se envían credenciales ni datos).
      const r = await getInsecureImage(url, BROWSER_HEADERS);
      if (!r.ok || !r.buf) {
        res.status(204).end();
        return;
      }
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file, r.buf);
      } catch (e: any) {
        this.logger.warn(`No se pudo cachear catastro ${muni}: ${e.message}`);
      }
      res.setHeader('Content-Type', r.contentType || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.setHeader('X-Tile-Cache', 'MISS');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(r.buf);
    } catch (e: any) {
      this.logger.warn(`Catastro ${muni} falló: ${e.message}`);
      res.status(204).end();
    }
  }

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

/**
 * Descarga una imagen por HTTPS con verificación TLS relajada. Necesario solo
 * para el servidor del AMVA, que presenta una cadena de certificados incompleta
 * (válida en Windows, rechazada por el almacén CA de Alpine). Es una fuente
 * pública de solo lectura; no se transmiten credenciales ni datos sensibles.
 */
function getInsecureImage(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; contentType?: string; buf?: Buffer }> {
  return new Promise((resolve) => {
    const req = https.get(url, { headers, rejectUnauthorized: false, timeout: 15000 }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c as Buffer));
      r.on('end', () => {
        const status = r.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          contentType: r.headers['content-type'],
          buf: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0 });
    });
  });
}
