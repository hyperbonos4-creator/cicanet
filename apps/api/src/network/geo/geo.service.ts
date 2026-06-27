import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { config } from '../../config';
// Polígono REAL del barrio (mismo dataset oficial de GeoMedellín que usa el mapa).
import geo from '../topology/popular2.geo.json';

export type GeocodeCandidate = {
  displayName: string;
  lat: number;
  lng: number;
  tipo: string;
  importancia: number;
  dentroDelBarrio: boolean;
};

export type IpLocation = {
  lat: number;
  lng: number;
  ciudad?: string;
  region?: string;
  pais?: string;
  ip?: string;
  fuente: 'ip-api' | 'fallback';
  dentroDelBarrio: boolean;
};

@Injectable()
export class GeoService {
  private readonly logger = new Logger('GeoService');

  /** ¿La coordenada cae dentro del polígono real del barrio Popular? */
  dentroDelBarrio(lng: number, lat: number): boolean {
    const pt = point([lng, lat]);
    return geo.sector.features.some((f) =>
      booleanPointInPolygon(pt as any, f as any),
    );
  }

  /**
   * Geocodifica una dirección real a coordenadas usando Nominatim (OpenStreetMap),
   * sesgado al área metropolitana de Medellín. Normaliza el formato colombiano
   * ("Calle 124 # 43-5"), añade el contexto de Medellín y prueba variantes
   * progresivamente más amplias hasta encontrar resultados. Devuelve candidatos
   * ordenados: primero los que caen dentro del barrio.
   */
  async geocode(query: string): Promise<GeocodeCandidate[]> {
    const raw = (query || '').trim();
    if (raw.length < 3) return [];

    // 0a) Google: idéntico a Google Maps (placa exacta colombiana).
    if (config.geo.geocoder === 'google' && config.geo.googleKey) {
      try {
        const g = await this.googleForward(raw);
        if (g.length) return g;
      } catch (e: any) {
        this.logger.warn(`Google forward falló (${raw}): ${e.message} — uso OSM`);
      }
    }

    // 0b) Mapbox: preciso a nivel de casa/cuadra.
    if (config.geo.geocoder === 'mapbox' && config.geo.mapboxToken) {
      try {
        const mb = await this.mapboxForward(raw);
        if (mb.length) return mb;
      } catch (e: any) {
        this.logger.warn(`Mapbox forward falló (${raw}): ${e.message} — uso OSM`);
      }
    }

    // 1) Geocodificación por INTERSECCIÓN (nomenclatura colombiana "Vía A # Vía B - placa").
    const parsed = parseColombianAddress(raw);
    if (parsed?.secondaryNum) {
      try {
        const corner = await this.geocodeIntersection(parsed);
        if (corner.length) return corner;
      } catch (e: any) {
        this.logger.warn(`Intersección falló (${raw}): ${e.message}`);
      }
    }

    // 2) Fallback: búsqueda de texto por variantes, ordenada por relevancia real.
    const variants = buildQueryVariants(raw);
    for (const v of variants) {
      const candidatos = await this.nominatimSearch(v);
      if (candidatos.length > 0) {
        candidatos.sort((a, b) => b.importancia - a.importancia);
        return candidatos;
      }
    }
    return [];
  }

  /** Geocodificación con Mapbox (datos comerciales, precisión a nivel de casa). */
  private async mapboxForward(query: string): Promise<GeocodeCandidate[]> {
    // Normaliza la nomenclatura colombiana y añade contexto de ciudad para que
    // Mapbox la entienda bien ("calle110#48b-12" -> "calle 110 48b-12, Medellín…").
    const norm = normalizeColombianAddress(query);
    const hasCtx = /medell[ií]n|antioquia|colombia|bello|itag[üu]i|envigado/i.test(norm);
    const q = hasCtx ? norm : `${norm}, Medellín, Antioquia, Colombia`;
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?access_token=${encodeURIComponent(config.geo.mapboxToken)}` +
      `&country=co&language=es&autocomplete=false&limit=8` +
      `&proximity=${encodeURIComponent(config.geo.proximity)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const mapped = (data.features || []).map((f: any) => {
      const [lng, lat] = f.center;
      return {
        displayName: f.place_name,
        lat,
        lng,
        tipo: (f.place_type && f.place_type[0]) || 'address',
        importancia: f.relevance ?? 0,
        dentroDelBarrio: this.dentroDelBarrio(lng, lat),
      };
    });
    return rankColombianResults(mapped, query);
  }

  /** Geocodificación con Google Geocoding API (idéntico a Google Maps). */
  private async googleForward(query: string): Promise<GeocodeCandidate[]> {
    const norm = normalizeColombianAddress(query);
    const hasCtx = /medell[ií]n|antioquia|colombia|bello|itag[üu]i|envigado/i.test(norm);
    const q = hasCtx ? norm : `${norm}, Medellín, Antioquia, Colombia`;
    const [sw, ne] = config.geo.bounds.split('|');
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(q)}` +
      `&key=${encodeURIComponent(config.geo.googleKey)}` +
      `&language=es&region=co&components=country:CO` +
      `&bounds=${encodeURIComponent(`${sw}|${ne}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google: ${data.status} ${data.error_message || ''}`);
    }
    const mapped = (data.results || []).map((r: any) => {
      const lat = r.geometry?.location?.lat;
      const lng = r.geometry?.location?.lng;
      const exacto = r.geometry?.location_type === 'ROOFTOP';
      return {
        displayName: r.formatted_address,
        lat,
        lng,
        tipo: (r.types && r.types[0]) || 'address',
        importancia: exacto ? 1 : 0.8,
        dentroDelBarrio: this.dentroDelBarrio(lng, lat),
      };
    });
    return rankColombianResults(mapped, query);
  }

  private async googleReverse(lat: number, lng: number): Promise<string | null> {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
      `&key=${encodeURIComponent(config.geo.googleKey)}&language=es`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results?.[0]?.formatted_address || null;
  }

  private async mapboxReverse(lat: number, lng: number): Promise<string | null> {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?access_token=${encodeURIComponent(config.geo.mapboxToken)}&language=es&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.features?.[0]?.place_name || null;
  }

  /** Busca calles con su geometría (LineString) en Nominatim. */
  private async fetchStreetsGeo(q: string, viewbox?: string): Promise<any[]> {
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      polygon_geojson: '1',
      addressdetails: '1',
      limit: '10',
      countrycodes: config.geo.countryCodes,
    });
    if (viewbox) {
      params.set('viewbox', viewbox);
      params.set('bounded', '0');
    }
    const res = await fetch(`${config.geo.nominatimUrl}/search?${params.toString()}`, {
      headers: { 'User-Agent': config.geo.userAgent, 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Calcula la ESQUINA: intersección de la vía principal con la perpendicular del "#".
   * Devuelve [esquina (si existe), víaPrincipal] para que el operador escoja.
   */
  private async geocodeIntersection(p: ParsedAddress): Promise<GeocodeCandidate[]> {
    const primQ = `${p.primaryType} ${p.primaryNum}, Medellín, Antioquia, Colombia`;
    const prims = await this.fetchStreetsGeo(primQ);
    const prim = prims.find((r) => r.geojson && /LineString/i.test(r.geojson.type));
    if (!prim) return [];

    const bb = geomBbox(prim.geojson);
    const pad = 0.02;
    const vb = `${bb[0] - pad},${bb[3] + pad},${bb[2] + pad},${bb[1] - pad}`;
    const secQ = `${p.secondaryType} ${p.secondaryNum}, Medellín, Antioquia, Colombia`;
    const secs = await this.fetchStreetsGeo(secQ, vb);

    let corner: number[] | null = null;

    // a) intersección exacta
    for (const s of secs) {
      if (!s.geojson) continue;
      const pts = allIntersections(prim.geojson, s.geojson);
      if (pts.length) {
        corner = pts[0];
        break;
      }
    }
    // b) aproximación: punto de la vía principal más cercano a la perpendicular (<= 150 m)
    if (!corner) {
      let bestD = Infinity;
      let bestPt: number[] | null = null;
      for (const s of secs) {
        if (!s.geojson) continue;
        const app = nearestApproach(prim.geojson, s.geojson);
        if (app && app.distDeg < bestD) {
          bestD = app.distDeg;
          bestPt = app.pt;
        }
      }
      if (bestPt && bestD * 111000 <= 150) corner = bestPt;
    }

    const out: GeocodeCandidate[] = [];
    if (corner) {
      const [lng, lat] = corner;
      const placa = p.plate ? '-' + p.plate.toUpperCase() : '';
      out.push({
        displayName: `${cap(p.primaryType)} ${p.primaryNum.toUpperCase()} con ${cap(p.secondaryType)} ${p.secondaryNum!.toUpperCase()}${placa} · ${shortName(prim.display_name)}`,
        lat,
        lng,
        tipo: 'esquina',
        importancia: 1,
        dentroDelBarrio: this.dentroDelBarrio(lng, lat),
      });
    }
    // Vía principal como alternativa (siempre es la calle correcta).
    const plng = parseFloat(prim.lon);
    const plat = parseFloat(prim.lat);
    out.push({
      displayName: prim.display_name,
      lat: plat,
      lng: plng,
      tipo: prim.addresstype || prim.type || 'road',
      importancia: prim.importance ?? 0,
      dentroDelBarrio: this.dentroDelBarrio(plng, plat),
    });
    return out;
  }

  /** Una consulta concreta a Nominatim. Lanza si el servicio falla (no si 0 resultados). */
  private async nominatimSearch(q: string): Promise<GeocodeCandidate[]> {
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '8',
      countrycodes: config.geo.countryCodes,
      viewbox: config.geo.viewbox,
      bounded: '0', // sesga hacia Medellín pero no excluye
    });
    const url = `${config.geo.nominatimUrl}/search?${params.toString()}`;

    let data: any[];
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': config.geo.userAgent, 'Accept-Language': 'es' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e: any) {
      this.logger.error(`Geocodificación falló (${q}): ${e.message}`);
      throw new ServiceUnavailableException(
        'El servicio de geocodificación no está disponible en este momento.',
      );
    }

    return (data || []).map((r) => {
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      return {
        displayName: r.display_name,
        lat,
        lng,
        tipo: r.addresstype || r.type || 'desconocido',
        importancia: r.importance ?? 0,
        dentroDelBarrio: this.dentroDelBarrio(lng, lat),
      };
    });
  }

  /** Geocodificación inversa: coordenadas -> dirección legible. */
  async reverse(lat: number, lng: number): Promise<string | null> {
    if (config.geo.geocoder === 'google' && config.geo.googleKey) {
      try {
        const a = await this.googleReverse(lat, lng);
        if (a) return a;
      } catch (e: any) {
        this.logger.warn(`Google reverse falló: ${e.message} — uso OSM`);
      }
    }
    if (config.geo.geocoder === 'mapbox' && config.geo.mapboxToken) {
      try {
        const a = await this.mapboxReverse(lat, lng);
        if (a) return a;
      } catch (e: any) {
        this.logger.warn(`Mapbox reverse falló: ${e.message} — uso OSM`);
      }
    }
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'jsonv2',
      'accept-language': 'es',
    });
    const url = `${config.geo.nominatimUrl}/reverse?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': config.geo.userAgent, 'Accept-Language': 'es' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.display_name || null;
    } catch (e: any) {
      this.logger.warn(`Reverse geocoding falló: ${e.message}`);
      return null;
    }
  }

  /**
   * Ruta REAL siguiendo las calles entre dos puntos (Mapbox Directions). Para
   * tendido de fibra se usa el perfil peatonal (`walking`), el más flexible para
   * seguir vías sin la restricción de sentidos del tráfico. Devuelve la polilínea
   * [[lng,lat],…] y la distancia en metros. Si no hay token o el servicio falla,
   * devuelve null para que el llamador use la línea recta como respaldo.
   */
  async routeAlongStreets(
    o: { lng: number; lat: number },
    d: { lng: number; lat: number },
    profile: 'walking' | 'driving' | 'cycling' = 'walking',
  ): Promise<{ coords: number[][]; distancia: number } | null> {
    const token = config.geo.mapboxToken;
    if (!token) return null;
    const coordsParam = `${o.lng},${o.lat};${d.lng},${d.lat}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordsParam}` +
      `?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        this.logger.warn(`Directions respondió ${res.status}; uso recta.`);
        return null;
      }
      const data: any = await res.json();
      const route = data?.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;
      return { coords, distancia: Math.round(route.distance ?? 0) };
    } catch (e: any) {
      this.logger.warn(`Directions falló: ${e.message}; uso recta.`);
      return null;
    }
  }

  /**
   * Polígono de ALCANCE (Isochrone) a `metros` siguiendo las calles desde un
   * punto — útil para el área real que una NAP puede servir por longitud de
   * tendido. Devuelve un FeatureCollection GeoJSON o null (respaldo del llamador).
   */
  async isochrone(
    lng: number,
    lat: number,
    metros: number,
    profile: 'walking' | 'driving' | 'cycling' = 'walking',
  ): Promise<any | null> {
    const token = config.geo.mapboxToken;
    if (!token) return null;
    const m = Math.max(50, Math.min(100000, Math.round(metros)));
    const url =
      `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${lng},${lat}` +
      `?contours_meters=${m}&polygons=true&denoise=1&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        this.logger.warn(`Isochrone respondió ${res.status}.`);
        return null;
      }
      const data: any = await res.json();
      if (!data?.features?.length) return null;
      return data;
    } catch (e: any) {
      this.logger.warn(`Isochrone falló: ${e.message}.`);
      return null;
    }
  }

  /**
   * Distancias por carretera/calle desde un origen a varios destinos (Matrix).
   * Devuelve metros por destino (null si inalcanzable) o null si no hay token /
   * falla. Mapbox Matrix admite 25 coordenadas: se limita a 24 destinos.
   */
  async travelDistances(
    origin: { lng: number; lat: number },
    dests: { lng: number; lat: number }[],
    profile: 'walking' | 'driving' | 'cycling' = 'walking',
  ): Promise<(number | null)[] | null> {
    const token = config.geo.mapboxToken;
    if (!token || dests.length === 0) return null;
    const limited = dests.slice(0, 24);
    const coords = [origin, ...limited].map((p) => `${p.lng},${p.lat}`).join(';');
    const destIdx = limited.map((_, i) => i + 1).join(';');
    const url =
      `https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coords}` +
      `?sources=0&destinations=${destIdx}&annotations=distance&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        this.logger.warn(`Matrix respondió ${res.status}.`);
        return null;
      }
      const data: any = await res.json();
      const row = data?.distances?.[0];
      if (!Array.isArray(row)) return null;
      return row.map((d: any) => (typeof d === 'number' ? Math.round(d) : null));
    } catch (e: any) {
      this.logger.warn(`Matrix falló: ${e.message}.`);
      return null;
    }
  }

  /**
   * Geolocaliza una IP pública real. Para IPs privadas/localhost (desarrollo)
   * devuelve el centro del barrio como fallback honesto (fuente: 'fallback').
   */
  /**
   * Street View: consulta la API de metadatos de Google (GRATIS) para saber si
   * existe panorámica cerca del punto. Devuelve disponibilidad, panoId, la
   * coordenada real del panorama y su fecha. No expone la clave al cliente.
   */
  async streetViewMeta(
    lat: number,
    lng: number,
    radius = 50,
  ): Promise<{
    disponible: boolean;
    panoId: string | null;
    lat: number;
    lng: number;
    fecha: string | null;
    fuente: string | null;
  }> {
    const sinDatos = { disponible: false, panoId: null, lat, lng, fecha: null, fuente: null };
    if (!config.geo.googleKey) return sinDatos;
    const url =
      `https://maps.googleapis.com/maps/api/streetview/metadata` +
      `?location=${lat},${lng}&radius=${radius}&source=outdoor` +
      `&key=${encodeURIComponent(config.geo.googleKey)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.status !== 'OK') return sinDatos;
      return {
        disponible: true,
        panoId: d.pano_id || null,
        lat: d.location?.lat ?? lat,
        lng: d.location?.lng ?? lng,
        fecha: d.date || null,
        fuente: d.copyright || null,
      };
    } catch (e: any) {
      this.logger.warn(`Street View metadata falló (${lat},${lng}): ${e.message}`);
      return sinDatos;
    }
  }

  async locateByIp(ip?: string): Promise<IpLocation> {
    const [cx, cy] = geo.meta.center;
    const fallback: IpLocation = {
      lat: cy,
      lng: cx,
      ciudad: 'Medellín',
      region: 'Antioquia',
      pais: 'Colombia',
      ip,
      fuente: 'fallback',
      dentroDelBarrio: true,
    };

    if (!ip || isPrivateIp(ip)) return fallback;

    try {
      const res = await fetch(
        `${config.geo.ipApiUrl}/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon,query`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.status !== 'success' || typeof d.lat !== 'number') return fallback;
      return {
        lat: d.lat,
        lng: d.lon,
        ciudad: d.city,
        region: d.regionName,
        pais: d.country,
        ip: d.query || ip,
        fuente: 'ip-api',
        dentroDelBarrio: this.dentroDelBarrio(d.lon, d.lat),
      };
    } catch (e: any) {
      this.logger.warn(`IP geolocation falló (${ip}): ${e.message}`);
      return fallback;
    }
  }
}

/** Detecta IPs no enrutables (localhost, LAN, IPv6 local) para usar fallback. */
function isPrivateIp(ip: string): boolean {
  const v = ip.replace('::ffff:', '').trim();
  if (
    v === '127.0.0.1' ||
    v === '::1' ||
    v === 'localhost' ||
    v === '' ||
    v.startsWith('10.') ||
    v.startsWith('192.168.') ||
    v.startsWith('169.254.') ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe80')
  ) {
    return true;
  }
  // 172.16.0.0 – 172.31.255.255
  const m = v.match(/^172\.(\d+)\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Normaliza una dirección en formato colombiano para que Nominatim la entienda:
 * "calle124#43-5" -> "calle 124 43-5". Inserta espacios entre palabra y número,
 * expande abreviaturas comunes y reemplaza el "#" / "No." por espacio.
 */
function normalizeColombianAddress(input: string): string {
  let s = ' ' + input.toLowerCase().trim() + ' ';

  // Abreviaturas de vía -> palabra completa (con límites de palabra).
  const abbr: Array<[RegExp, string]> = [
    [/\b(cl|cll|clle)\.?\s/g, ' calle '],
    [/\b(cr|cra|kra|kr|car)\.?\s/g, ' carrera '],
    [/\b(dg|diag)\.?\s/g, ' diagonal '],
    [/\b(tv|trans|tranv)\.?\s/g, ' transversal '],
    [/\b(av|avda)\.?\s/g, ' avenida '],
    [/\b(cq|circ)\.?\s/g, ' circular '],
  ];
  for (const [re, rep] of abbr) s = s.replace(re, rep);

  // "#" y "No." / "Nro" -> espacio
  s = s.replace(/\s*(#|n[°ºo]\.?|nro\.?|num\.?)\s*/gi, ' ');

  // Quita calificadores de interior/apartamento: no ayudan a geocodificar la
  // dirección de calle y bajan la relevancia ("...43c-136 int 101" -> "...43c-136").
  s = s.replace(/\s+(int|interior|apto|apartamento|apartaestudio|torre|bloque|bl|piso|of|oficina|local)\.?\s*\d*\s*$/gi, ' ');

  // Inserta espacio SOLO entre palabra y dígito: "calle124" -> "calle 124".
  // NO se separa dígito de letra: la nomenclatura colombiana usa sufijos de vía
  // ("77DD", "43A", "30B") que DEBEN quedar pegados al número o Nominatim falla.
  s = s.replace(/([a-záéíóúñ])(\d)/gi, '$1 $2');

  // Normaliza separadores y espacios
  s = s.replace(/\s*-\s*/g, '-'); // "43 - 5" -> "43-5"
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Construye variantes de consulta de más específica a más amplia, añadiendo el
 * contexto de Medellín cuando falta, para maximizar el acierto.
 */
function buildQueryVariants(raw: string): string[] {
  const norm = normalizeColombianAddress(raw);
  const hasCtx =
    /medell[ií]n|antioquia|colombia|bello|itag[üu]i|envigado|robledo|popular|santo\s*domingo|aranjuez|c[óo]rdoba/i.test(
      norm,
    );
  const ctx = ', Medellín, Antioquia, Colombia';

  const variants: string[] = [];
  const add = (q: string) => {
    const t = q.trim().replace(/^,|,$/g, '').trim();
    if (t.length >= 3 && !variants.includes(t)) variants.push(t);
  };

  if (hasCtx) {
    add(norm);
    add(norm + ', Colombia');
  } else {
    add(norm + ctx);
    add(norm + ', Medellín, Colombia');
  }

  // Solo la vía con su sufijo (sin placa), p.ej. "calle 77dd 71-30" -> "calle 77dd".
  // El sufijo de hasta 3 letras (77DD, 43A) se mantiene pegado al número.
  const via = norm.match(
    /^\s*(calle|carrera|diagonal|transversal|avenida|circular)\s+\d+[a-z]{0,3}/i,
  );
  if (via && via[0].trim() !== norm) add(via[0].trim() + ctx);

  // Última red: el texto crudo tal cual lo escribió el usuario.
  add(raw);

  return variants;
}

// ===========================================================================
//  Geocodificación por intersección (nomenclatura colombiana)
// ===========================================================================

type ParsedAddress = {
  primaryType: string;
  primaryNum: string;
  secondaryType: string;
  secondaryNum?: string;
  plate?: string;
};

/**
 * Parsea "Calle 77DD # 71-30" -> { primaryType: calle, primaryNum: 77dd,
 * secondaryType: carrera, secondaryNum: 71, plate: 30 }. La perpendicular es
 * siempre el tipo de vía opuesto (calle <-> carrera).
 */
function parseColombianAddress(raw: string): ParsedAddress | null {
  const n = normalizeColombianAddress(raw); // ej. "calle 77dd 71-30"
  const m = n.match(
    /^(calle|carrera|diagonal|transversal|circular|avenida)\s+(\d+[a-z]{0,3})(?:\s+(\d+[a-z]{0,3}))?(?:-(\d+[a-z]{0,3}))?/i,
  );
  if (!m) return null;
  const primaryType = m[1].toLowerCase();
  const opp: Record<string, string> = {
    calle: 'carrera',
    carrera: 'calle',
    diagonal: 'carrera',
    transversal: 'calle',
    circular: 'carrera',
    avenida: 'carrera',
  };
  return {
    primaryType,
    primaryNum: m[2],
    secondaryType: opp[primaryType] || 'carrera',
    secondaryNum: m[3],
    plate: m[4],
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Re-ordena y filtra los candidatos de un proveedor (Mapbox/Google) según la
 * VÍA PRINCIPAL que escribió el usuario. En la Comuna 1 los proveedores no
 * tienen los números de casa, así que devuelven coincidencias difusas y, peor,
 * reinterpretan el número de calle como número de casa ("Calle 126 #43c-136" ->
 * "Calle 103B 126"). Esto deja arriba solo lo que de verdad cae en la calle
 * pedida y descarta el ruido. Si nada coincide, conserva lo más relevante.
 */
function rankColombianResults(
  results: GeocodeCandidate[],
  query: string,
): GeocodeCandidate[] {
  if (!results.length) return results;
  const norm = normalizeColombianAddress(query);
  const m = norm.match(
    /^(calle|carrera|diagonal|transversal|avenida|circular)\s+\d+[a-z]{0,3}/i,
  );
  // dedup por displayName
  const seen = new Set<string>();
  const uniq = results.filter((r) => {
    const k = (r.displayName || '').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!m) {
    return uniq.sort((a, b) => b.importancia - a.importancia).slice(0, 6);
  }

  const primary = m[0].trim().toLowerCase(); // ej. "calle 126"
  const re = new RegExp('\\b' + primary.replace(/\s+/g, '\\s+') + '\\b', 'i');
  const scored = uniq.map((r) => ({ r, match: re.test((r.displayName || '').toLowerCase()) }));
  scored.sort((a, b) => Number(b.match) - Number(a.match) || b.r.importancia - a.r.importancia);

  const anyMatch = scored.some((s) => s.match);
  // Si hay resultados en la calle correcta, mostramos SOLO esos (sin ruido).
  // Si ninguno coincide, mostramos los más relevantes para no dejar vacío.
  const kept = scored.filter((s) => (anyMatch ? s.match : s.r.importancia >= 0.5));
  return (kept.length ? kept : scored).map((s) => s.r).slice(0, 6);
}

function shortName(displayName: string): string {
  return (displayName || '').split(',').slice(1, 3).join(',').trim();
}

// ---- geometría ----
function geomBbox(geom: any): number[] {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const walk = (a: any) => {
    if (typeof a[0] === 'number') {
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
      minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
    } else a.forEach(walk);
  };
  walk(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

/** Segmentos [[x,y],[x,y]] de una geometría Line/MultiLine/Polygon. */
function segmentsOf(geom: any): number[][][] {
  const segs: number[][][] = [];
  const addLine = (coords: number[][]) => {
    for (let i = 0; i < coords.length - 1; i++) segs.push([coords[i], coords[i + 1]]);
  };
  if (!geom) return segs;
  if (geom.type === 'LineString') addLine(geom.coordinates);
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(addLine);
  else if (geom.type === 'Polygon') geom.coordinates.forEach(addLine);
  return segs;
}

function segIntersect(p1: number[], p2: number[], p3: number[], p4: number[]): number[] | null {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function allIntersections(geomA: any, geomB: any): number[][] {
  const A = segmentsOf(geomA), B = segmentsOf(geomB);
  const pts: number[][] = [];
  for (const a of A) for (const b of B) {
    const p = segIntersect(a[0], a[1], b[0], b[1]);
    if (p) pts.push(p);
  }
  return pts;
}

function nearestOnSeg(p: number[], a: number[], b: number[]): number[] {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * dx, ay + t * dy];
}

function dist2(a: number[], b: number[]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Punto de la vía principal más cercano a la secundaria (aprox. de la esquina). */
function nearestApproach(geomPrimary: any, geomSecondary: any): { pt: number[]; distDeg: number } | null {
  const A = segmentsOf(geomPrimary), B = segmentsOf(geomSecondary);
  let best: number[] | null = null;
  let bestD = Infinity;
  for (const a of A) {
    for (const b of B) {
      for (const vb of b) {
        const q = nearestOnSeg(vb, a[0], a[1]);
        const d = dist2(q, vb);
        if (d < bestD) { bestD = d; best = q; }
      }
      for (const va of a) {
        const q = nearestOnSeg(va, b[0], b[1]);
        const d = dist2(va, q);
        if (d < bestD) { bestD = d; best = va; }
      }
    }
  }
  return best ? { pt: best, distDeg: Math.sqrt(bestD) } : null;
}
