import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { config } from '../config';
import { InfraService } from '../infra/infra.service';
// Dataset generado a partir del GeoJSON OFICIAL de GeoMedellín (Comuna 1).
// Ver apps/api/scripts/build-geodata.mjs
import geo from './popular2.geo.json';

type FC = { type: 'FeatureCollection'; features: any[] };

const ESTADO_LABEL: Record<string, string> = {
  ftth: 'FTTH disponible',
  parcial: 'Cobertura parcial (NAP saturada)',
  sin: 'Sin cobertura (expansión planeada)',
};

/** Registro persistido de una NAP/CTO creada por un operador. */
export type NapRecord = {
  id: string;
  nombre: string;
  tipo: 'NAP' | 'CTO';
  lng: number;
  lat: number;
  puertos_total: number;
  puertos_usados: number;
  direccion?: string;
  creadoPor?: string;
  creadoEn: string;
};

/** Zona de cobertura dibujada por un operador (polígono lng/lat). */
export type ZoneRecord = {
  id: string;
  nombre: string;
  anillo: number[][]; // [[lng,lat], ...] cerrado
  creadoPor?: string;
  creadoEn: string;
};

@Injectable()
export class NetworkService implements OnModuleInit {
  private readonly logger = new Logger('NetworkService');

  // El inventario "fuente de verdad" vive en InfraService (editor GIS). Lo
  // inyectamos para que la consulta de cobertura del Mapa reconozca las NAP
  // reales que se construyen ahí (no solo el store heredado de naps.json).
  constructor(private readonly infra: InfraService) {}

  // La red arranca VACÍA: nodos, cobertura y fibra se construyen con la
  // infraestructura REAL que el operador registra (no hay datos demo).
  // Lo único que se conserva del dataset base son los límites oficiales de
  // barrios/comuna (meta, comuna1, sector) como contexto geográfico real.
  private nodes: FC = { type: 'FeatureCollection', features: [] };
  private coverage: FC = { type: 'FeatureCollection', features: [] };
  private fiber: FC = { type: 'FeatureCollection', features: [] };

  // NAPs creadas en runtime (persistidas). Se derivan a features del mapa.
  private naps: NapRecord[] = [];
  private readonly dataFile = resolve(
    process.cwd(),
    config.geo.dataDir,
    'naps.json',
  );

  // Zonas de cobertura dibujadas (persistidas).
  private zones: ZoneRecord[] = [];
  private readonly zonesFile = resolve(
    process.cwd(),
    config.geo.dataDir,
    'zones.json',
  );

  onModuleInit() {
    this.loadNaps();
    this.loadZones();
  }

  getMeta() {
    return geo.meta;
  }
  getComuna1() {
    return geo.comuna1;
  }
  getSector() {
    return geo.sector;
  }
  getCoverage() {
    return this.coverage;
  }
  getFiber() {
    return this.fiber;
  }
  getClients(): FC {
    // Sin clientes demo: los clientes reales viven en la base de datos (módulo
    // clientes) y se georreferencian aparte. El mapa de red no inventa puntos.
    return { type: 'FeatureCollection', features: [] };
  }
  getNodes() {
    return this.nodes;
  }

  getZones() {
    return {
      type: 'FeatureCollection',
      features: this.zones.map((z) => ({
        type: 'Feature',
        properties: { id: z.id, nombre: z.nombre, origen: 'zona' },
        geometry: { type: 'Polygon', coordinates: [z.anillo] },
      })),
    };
  }

  /** ¿El punto está en la zona de servicio? = dentro de un barrio oficial O de una zona dibujada. */
  isInServiceArea(lng: number, lat: number): boolean {
    const pt = point([lng, lat]);
    const inBarrio = geo.sector.features.some((f) =>
      booleanPointInPolygon(pt as any, f as any),
    );
    if (inBarrio) return true;
    return this.zones.some((z) =>
      booleanPointInPolygon(pt as any, zonePolygon(z) as any),
    );
  }

  getStats() {
    const nodosOnline = this.nodes.features.filter(
      (f) => f.properties.estado === 'online',
    ).length;
    const naps = this.nodes.features.filter((f) =>
      ['NAP', 'CTO'].includes(f.properties.tipo),
    ).length;
    // Estadísticas REALES derivadas de la infraestructura registrada (sin demo).
    return {
      naps,
      nodosOnline,
      nodosTotales: this.nodes.features.length,
    };
  }

  /**
   * ¿Esta coordenada tiene cobertura? Prioridad: zona FTTH > parcial > sin.
   * Si no cae en ninguna zona pero está dentro del barrio Popular real,
   * se reporta como "sin cobertura aún". Fuera del barrio: fuera de zona.
   */
  checkCoverage(lng: number, lat: number) {
    const pt = point([lng, lat]);
    const prioridad = ['ftth', 'parcial', 'sin'];

    // 1) Cobertura por polígonos (zonas dibujadas / círculos del store heredado).
    const matches = this.coverage.features.filter((f) =>
      booleanPointInPolygon(pt as any, f as any),
    );
    matches.sort(
      (a, b) =>
        prioridad.indexOf(a.properties.estado) -
        prioridad.indexOf(b.properties.estado),
    );
    const best = matches[0];
    const polyEstado: string | null = best ? best.properties.estado : null;

    // 2) Cobertura por CERCANÍA a una NAP real del editor GIS (fuente de verdad).
    //    Si el punto está dentro del radio de tendido de una NAP con puertos
    //    libres → FTTH; si la NAP está saturada → parcial.
    const RADIO_TENDIDO = 250; // m
    let infraEstado: string | null = null;
    for (const n of this.infra.getNapPoints()) {
      if (haversine(lat, lng, n.lat, n.lng) <= RADIO_TENDIDO) {
        const est = n.libres > 0 ? 'ftth' : 'parcial';
        if (!infraEstado || prioridad.indexOf(est) < prioridad.indexOf(infraEstado)) infraEstado = est;
      }
    }

    // 3) Mejor estado entre ambas fuentes (ftth > parcial > sin).
    const estado = [polyEstado, infraEstado]
      .filter((e): e is string => !!e)
      .sort((a, b) => prioridad.indexOf(a) - prioridad.indexOf(b))[0] ?? null;

    const dentroDelBarrio = this.isInServiceArea(lng, lat);
    const napCercano = this.nearestNap(lng, lat);

    if (!estado) {
      return {
        cobertura: false,
        estado: dentroDelBarrio ? 'sin' : 'fuera_de_zona',
        mensaje: dentroDelBarrio
          ? 'En tu zona aún no hay red, pero está en el plan de expansión.'
          : 'El punto está fuera de tu zona de servicio.',
        dentroDelBarrio,
        napCercano,
        lng,
        lat,
      };
    }

    return {
      cobertura: estado !== 'sin',
      estado,
      tecnologia: best?.properties.tecnologia || (estado === 'sin' ? 'FTTH (planeado)' : 'FTTH'),
      area: best?.properties.nombre,
      mensaje: ESTADO_LABEL[estado] || estado,
      dentroDelBarrio,
      napCercano,
      lng,
      lat,
    };
  }

  /** NAP más cercana considerando AMBAS fuentes: el store heredado y el editor GIS (infra). */
  private nearestNap(lng: number, lat: number): { id: string; nombre: string; metros: number; libres: number } | null {
    let best: { id: string; nombre: string; metros: number; libres: number } | null = null;
    const consider = (id: string, nombre: string, nlng: number, nlat: number, libres: number) => {
      const metros = haversine(lat, lng, nlat, nlng);
      if (!best || metros < best.metros) best = { id, nombre, metros: Math.round(metros), libres };
    };
    for (const f of this.nodes.features) {
      if (!['NAP', 'CTO'].includes(f.properties.tipo)) continue;
      const [nlng, nlat] = f.geometry.coordinates;
      consider(f.properties.id, f.properties.nombre, nlng, nlat, f.properties.puertos_total - f.properties.puertos_usados);
    }
    for (const n of this.infra.getNapPoints()) {
      consider(n.id, n.nombre, n.lng, n.lat, n.libres);
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  //  Gestión de NAP por dirección/coordenada exacta (infraestructura)
  // ---------------------------------------------------------------------------

  listNaps(): NapRecord[] {
    return this.naps;
  }

  /**
   * Da de alta una NAP/CTO en una coordenada exacta (ya geocodificada).
   * Valida que cae dentro del barrio real. La ubica en el mapa sin error
   * y genera su zona de cobertura y enlace de fibra al POP.
   */
  addNap(input: {
    nombre?: string;
    tipo?: 'NAP' | 'CTO';
    lng: number;
    lat: number;
    puertos_total?: number;
    puertos_usados?: number;
    direccion?: string;
    creadoPor?: string;
  }): NapRecord {
    const { lng, lat } = input;
    if (typeof lng !== 'number' || typeof lat !== 'number') {
      throw new BadRequestException('Coordenadas inválidas.');
    }
    const dentro = this.isInServiceArea(lng, lat);
    if (!dentro) {
      throw new BadRequestException(
        'La ubicación está fuera de tu zona de servicio; no se puede instalar la NAP ahí.',
      );
    }

    const tipo = input.tipo === 'CTO' ? 'CTO' : 'NAP';
    const total = clampInt(input.puertos_total, tipo === 'CTO' ? 8 : 16, 1, 256);
    const usados = clampInt(input.puertos_usados, 0, 0, total);
    const id = this.nextNapId(tipo);

    const record: NapRecord = {
      id,
      nombre: input.nombre?.trim() || id,
      tipo,
      lng: round(lng),
      lat: round(lat),
      puertos_total: total,
      puertos_usados: usados,
      direccion: input.direccion?.trim() || undefined,
      creadoPor: input.creadoPor,
      creadoEn: new Date().toISOString(),
    };

    this.naps.push(record);
    this.applyNap(record);
    this.persist();
    this.logger.log(`NAP creada ${id} @ [${record.lng}, ${record.lat}]`);
    return record;
  }

  deleteNap(id: string): { id: string } {
    const idx = this.naps.findIndex((n) => n.id === id);
    if (idx === -1) {
      throw new NotFoundException(
        'Esa NAP no existe o pertenece al inventario base (no editable).',
      );
    }
    this.naps.splice(idx, 1);
    this.nodes.features = this.nodes.features.filter(
      (f) => f.properties.id !== id,
    );
    this.coverage.features = this.coverage.features.filter(
      (f) => f.properties.id !== `COV-${id}`,
    );
    this.fiber.features = this.fiber.features.filter(
      (f) => f.properties.id !== `FIB-${id}`,
    );
    this.persist();
    this.logger.log(`NAP eliminada ${id}`);
    return { id };
  }

  /** Inserta/refresca las features de mapa derivadas de un registro de NAP. */
  private applyNap(r: NapRecord) {
    const ratio = r.puertos_total > 0 ? r.puertos_usados / r.puertos_total : 1;
    let estadoCobertura: 'ftth' | 'parcial' | 'sin' = 'ftth';
    if (r.puertos_usados === 0) estadoCobertura = 'sin';
    else if (ratio >= 0.9) estadoCobertura = 'parcial';

    // Nodo
    this.nodes.features.push({
      type: 'Feature',
      properties: {
        id: r.id,
        nombre: r.nombre,
        tipo: r.tipo,
        estado: r.puertos_usados >= r.puertos_total ? 'degradado' : 'online',
        puertos_total: r.puertos_total,
        puertos_usados: r.puertos_usados,
        direccion: r.direccion,
        origen: 'runtime',
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });

    // Zona de cobertura (círculo geodésico)
    const radio = r.tipo === 'CTO' ? 130 : 190;
    this.coverage.features.push({
      type: 'Feature',
      properties: {
        id: `COV-${r.id}`,
        nombre: `Cobertura ${r.id}`,
        estado: estadoCobertura,
        tecnologia: estadoCobertura === 'sin' ? 'FTTH (planeado)' : 'FTTH',
        clientes: Math.round(r.puertos_usados * 1.4),
      },
      geometry: { type: 'Polygon', coordinates: circle(r.lng, r.lat, radio) },
    });

    // Fibra troncal POP -> NAP
    const pop = this.nodes.features.find((f) => f.properties.tipo === 'POP');
    if (pop) {
      this.fiber.features.push({
        type: 'Feature',
        properties: { id: `FIB-${r.id}` },
        geometry: {
          type: 'LineString',
          coordinates: [pop.geometry.coordinates, [r.lng, r.lat]],
        },
      });
    }
  }

  private nextNapId(tipo: 'NAP' | 'CTO'): string {
    const prefix = tipo;
    let max = 0;
    for (const f of this.nodes.features) {
      const m = String(f.properties.id).match(
        new RegExp(`^${prefix}-(\\d+)`),
      );
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(2, '0')}`;
  }

  private loadNaps() {
    try {
      if (!existsSync(this.dataFile)) return;
      const raw = JSON.parse(readFileSync(this.dataFile, 'utf8'));
      if (Array.isArray(raw)) {
        this.naps = raw;
        this.naps.forEach((r) => this.applyNap(r));
        this.logger.log(`${this.naps.length} NAP(s) cargada(s) de ${this.dataFile}`);
      }
    } catch (e: any) {
      this.logger.warn(`No se pudieron cargar NAPs persistidas: ${e.message}`);
    }
  }

  private persist() {
    try {
      const dir = resolve(process.cwd(), config.geo.dataDir);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.dataFile, JSON.stringify(this.naps, null, 2));
    } catch (e: any) {
      this.logger.error(`No se pudieron persistir las NAPs: ${e.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  //  Zonas de cobertura dibujadas por el operador
  // ---------------------------------------------------------------------------

  listZones(): ZoneRecord[] {
    return this.zones;
  }

  addZone(input: { nombre?: string; puntos: number[][]; creadoPor?: string }): ZoneRecord {
    const pts = (input.puntos || []).filter(
      (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    );
    if (pts.length < 3) {
      throw new BadRequestException('Una zona necesita al menos 3 puntos.');
    }
    // Cierra el anillo (primer punto == último)
    const anillo = pts.map((p) => [round(p[0]), round(p[1])]);
    const [fx, fy] = anillo[0];
    const [lx, ly] = anillo[anillo.length - 1];
    if (fx !== lx || fy !== ly) anillo.push([fx, fy]);

    let max = 0;
    for (const z of this.zones) {
      const m = String(z.id).match(/^ZON-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const record: ZoneRecord = {
      id: `ZON-${String(max + 1).padStart(2, '0')}`,
      nombre: input.nombre?.trim() || `Zona ${max + 1}`,
      anillo,
      creadoPor: input.creadoPor,
      creadoEn: new Date().toISOString(),
    };
    this.zones.push(record);
    this.persistZones();
    this.logger.log(`Zona creada ${record.id} (${anillo.length - 1} vértices)`);
    return record;
  }

  deleteZone(id: string): { id: string } {
    const idx = this.zones.findIndex((z) => z.id === id);
    if (idx === -1) throw new NotFoundException('Esa zona no existe.');
    this.zones.splice(idx, 1);
    this.persistZones();
    this.logger.log(`Zona eliminada ${id}`);
    return { id };
  }

  private loadZones() {
    try {
      if (!existsSync(this.zonesFile)) return;
      const raw = JSON.parse(readFileSync(this.zonesFile, 'utf8'));
      if (Array.isArray(raw)) {
        this.zones = raw;
        this.logger.log(`${this.zones.length} zona(s) cargada(s) de ${this.zonesFile}`);
      }
    } catch (e: any) {
      this.logger.warn(`No se pudieron cargar zonas: ${e.message}`);
    }
  }

  private persistZones() {
    try {
      const dir = resolve(process.cwd(), config.geo.dataDir);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.zonesFile, JSON.stringify(this.zones, null, 2));
    } catch (e: any) {
      this.logger.error(`No se pudieron persistir las zonas: ${e.message}`);
    }
  }

  /**
   * Estado de los nodos para el indicador "En vivo". No fabrica telemetría:
   * devuelve el estado real actual. La telemetría real (ocupación, caídas)
   * se integrará vía SNMP/LibreNMS o el polling de los OLT.
   */
  tick(_seed: number) {
    return this.nodes;
  }
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Círculo geodésico aproximado (radio en metros) -> anillo [lng,lat]. */
function circle(lng: number, lat: number, radiusM: number, steps = 48) {
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([round(lng + dLng * Math.cos(a)), round(lat + dLat * Math.sin(a))]);
  }
  return [ring];
}

function clampInt(v: any, def: number, min: number, max: number): number {
  const n = Number.isFinite(v) ? Math.round(v) : def;
  return Math.max(min, Math.min(max, n));
}

function round(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/** Construye un Feature Polygon a partir de una zona dibujada. */
function zonePolygon(z: ZoneRecord) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [z.anillo] },
  };
}
