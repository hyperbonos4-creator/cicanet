import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config';
import { GeoService } from '../geo/geo.service';
import type { Asset, AssetType, FiberSegment, Site } from './domain/types';
import { semaphore as capSemaphore, freePorts } from './domain/capacity';
import { descendants as topoDescendants, dependentClients, type TopoNode } from './domain/topology';
import {
  evaluateConstruction as evalConstruction,
  type NapCandidate,
} from './domain/construction';

const PREFIX: Record<string, string> = {
  POP: 'POP',
  OLT: 'OLT',
  Switch: 'SW',
  Router: 'RT',
  NAP: 'NAP',
  Splitter: 'SPL',
  UPS: 'UPS',
  Servidor: 'SRV',
  Camara: 'CAM',
  Fibra: 'FIB',
  Empalme: 'EMP',
  ONU: 'ONU',
  Cliente: 'CL',
};

/**
 * Gemelo Digital de la Red — almacenamiento en memoria + persistencia JSON.
 * La red se TRAZA agregando objetos reales por dirección (geocodificados con
 * el proveedor configurado, Mapbox). Evoluciona hacia PostGIS (spec, tarea 14).
 */
@Injectable()
export class InfraService implements OnModuleInit {
  private readonly logger = new Logger('InfraService');
  private assets: Asset[] = [];
  private fiber: FiberSegment[] = [];
  private sites: Site[] = [];

  private readonly dir = resolve(process.cwd(), config.geo.dataDir);
  private readonly assetsFile = resolve(this.dir, 'infra-assets.json');
  private readonly fiberFile = resolve(this.dir, 'infra-fiber.json');
  private readonly sitesFile = resolve(this.dir, 'infra-sites.json');

  constructor(private readonly geo: GeoService) {}

  onModuleInit() {
    this.assets = this.load(this.assetsFile);
    this.fiber = this.load(this.fiberFile);
    this.sites = this.load(this.sitesFile);
    this.logger.log(
      `Infra cargada: ${this.assets.length} activos · ${this.fiber.length} fibras · ${this.sites.length} sitios`,
    );
  }

  // ---- lectura ----
  listAssets() {
    return this.assets;
  }
  listFiber() {
    return this.fiber;
  }
  listSites() {
    return this.sites;
  }

  /** Proyección a nodos de topología (grafo padreId) para los helpers de dominio. */
  private topoNodes(): TopoNode[] {
    return this.assets.map((a) => ({ id: a.id, padreId: a.padreId ?? null, tipo: a.tipo }));
  }

  /** Capacidad de un activo (NAP/CTO) leída de sus atributos. null si no aplica. */
  private capacityOf(a: Asset): { total: number; usados: number; libres: number; semaforo: string } | null {
    if (a.tipo !== 'NAP') return null;
    const total = Number(a.atributos?.puertosTotal ?? a.atributos?.puertos_total ?? 0);
    const usados = Number(a.atributos?.puertosUsados ?? a.atributos?.puertos_usados ?? 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    const safeUsados = Math.max(0, Math.min(usados, total));
    return {
      total,
      usados: safeUsados,
      libres: freePorts(total, safeUsados),
      semaforo: capSemaphore(total, safeUsados),
    };
  }

  /** Impacto de un activo: clientes dependientes, NAPs aguas abajo e ingresos mensuales. */
  private impactOf(id: string): { clientesDependientes: number; napsDependientes: number; ingresosMensuales: number } {
    const nodes = this.topoNodes();
    const byId = new Map(this.assets.map((a) => [a.id, a]));
    const descIds = topoDescendants(nodes, id);
    const clientes = dependentClients(nodes, id);
    const naps = descIds.filter((d) => byId.get(d)?.tipo === 'NAP').length;
    const ingresosMensuales = clientes.reduce((sum, c) => sum + (byId.get(c)?.planMensual || 0), 0);
    return { clientesDependientes: clientes.length, napsDependientes: naps, ingresosMensuales };
  }

  /**
   * Modo construcción / simulador de venta: evalúa un punto contra las NAP
   * reales. Devuelve la NAP más cercana, viabilidad, costo y tiempo estimados.
   * La Distancia_Tendido se aproxima por distancia geodésica (línea recta);
   * el cálculo por rutas reales requiere un motor de ruteo (futuro).
   */
  evaluateConstruction(lng: number, lat: number) {
    const DEFAULT_DISTANCIA_MAX = 300; // metros (longitud típica de acometida FTTH)
    const candidates: (NapCandidate & { nombre: string; lng: number; lat: number })[] = this.assets
      .filter((a) => a.tipo === 'NAP')
      .map((a) => {
        const cap = this.capacityOf(a);
        const distanciaTendido = Math.round(haversine(lat, lng, a.lat, a.lng));
        const distanciaMax = Number(a.atributos?.distanciaMax) || DEFAULT_DISTANCIA_MAX;
        return {
          id: a.id,
          nombre: a.nombre,
          lng: a.lng,
          lat: a.lat,
          puertosLibres: cap?.libres ?? 0,
          distanciaTendido,
          distanciaMax,
        };
      });

    const evalr = evalConstruction(candidates);
    const nap = evalr.nap
      ? candidates.find((c) => c.id === evalr.nap!.id) || null
      : null;

    return {
      punto: { lng, lat },
      resultado: evalr.resultado, // 'instalable' | 'no_instalable'
      causa: evalr.causa, // 'sin_puertos' | 'fuera_de_alcance' | null
      distanciaTendido: evalr.distanciaTendido,
      puertosLibres: evalr.puertosLibres,
      costoEstimado: evalr.costoEstimado,
      tiempoEstimadoDias: evalr.tiempoEstimadoDias,
      nap: nap
        ? { id: nap.id, nombre: nap.nombre, lng: nap.lng, lat: nap.lat, distanciaMax: nap.distanciaMax }
        : null,
    };
  }

  /** Bundle GeoJSON para pintar SOLO la red real en el mapa. */
  getBundle() {
    const nodes = this.topoNodes();
    const byId = new Map(this.assets.map((a) => [a.id, a]));

    return {
      assets: {
        type: 'FeatureCollection',
        features: this.assets.map((a) => {
          const cap = this.capacityOf(a);
          return {
            type: 'Feature',
            properties: {
              id: a.id,
              tipo: a.tipo,
              nombre: a.nombre,
              estado: a.estado,
              direccion: a.direccion,
              padreId: a.padreId || null,
              padreNombre: a.padreId ? byId.get(a.padreId)?.nombre || null : null,
              clientesDependientes: dependentClients(nodes, a.id).length,
              // Capacidad y semáforo (R9) para NAP/CTO.
              puertosTotal: cap?.total ?? null,
              puertosUsados: cap?.usados ?? null,
              puertosLibres: cap?.libres ?? null,
              semaforo: cap?.semaforo ?? null,
              ...a.atributos,
            },
            geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
          };
        }),
      },
      fiber: {
        type: 'FeatureCollection',
        features: this.fiber.map((f) => ({
          type: 'Feature',
          properties: {
            id: f.id,
            nombre: f.nombre,
            longitud: f.longitud,
            hilos: f.hilos,
            tipoFibra: f.tipoFibra,
          },
          geometry: { type: 'LineString', coordinates: f.trazado },
        })),
      },
      sites: {
        type: 'FeatureCollection',
        features: this.sites.map((s) => ({
          type: 'Feature',
          properties: { id: s.id, nombre: s.nombre },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        })),
      },
      stats: {
        activos: this.assets.length,
        fibras: this.fiber.length,
        metrosFibra: Math.round(this.fiber.reduce((s, f) => s + f.longitud, 0)),
        sitios: this.sites.length,
      },
    };
  }

  // ---- alta de activos ----
  async createAsset(input: {
    tipo: AssetType;
    nombre?: string;
    direccion?: string;
    lng?: number;
    lat?: number;
    marca?: string;
    modelo?: string;
    serie?: string;
    estado?: string;
    propio?: boolean;
    regimen?: string;
    padreId?: string | null;
    planMensual?: number;
    atributos?: Record<string, any>;
    creadoPor?: string;
  }): Promise<Asset> {
    const { lng, lat, direccion } = await this.resolvePoint(input.lng, input.lat, input.direccion);

    const id = this.nextId(PREFIX[input.tipo] || 'AST');
    const asset: Asset = {
      id,
      tipo: input.tipo,
      nombre: input.nombre?.trim() || id,
      marca: input.marca,
      modelo: input.modelo,
      serie: input.serie,
      direccion,
      lng,
      lat,
      estado: (input.estado as any) || 'Activo',
      propio: input.propio !== false,
      regimen: input.regimen as any,
      padreId: input.padreId ?? null,
      planMensual: input.planMensual,
      atributos: input.atributos || {},
      creadoPor: input.creadoPor,
      creadoEn: new Date().toISOString(),
    };
    this.assets.push(asset);
    this.persist(this.assetsFile, this.assets);
    this.logger.log(`Activo creado ${id} (${asset.tipo}) @ [${lng}, ${lat}]`);
    return asset;
  }

  deleteAsset(id: string) {
    const i = this.assets.findIndex((a) => a.id === id);
    if (i === -1) throw new NotFoundException('Activo no encontrado.');
    this.assets.splice(i, 1);
    this.persist(this.assetsFile, this.assets);
    return { id };
  }

  // ---- alta de fibra (lo que traza la red) ----
  async createFiber(input: {
    nombre?: string;
    tipoFibra?: 'monomodo' | 'multimodo';
    hilos?: number;
    origenId?: string;
    destinoId?: string;
    origenDireccion?: string;
    destinoDireccion?: string;
    origen?: { lng: number; lat: number };
    destino?: { lng: number; lat: number };
    creadoPor?: string;
  }): Promise<FiberSegment> {
    const o = await this.resolveEndpoint(input.origenId, input.origenDireccion, input.origen);
    const d = await this.resolveEndpoint(input.destinoId, input.destinoDireccion, input.destino);

    if (o.lng === d.lng && o.lat === d.lat) {
      throw new BadRequestException('El origen y el destino de la fibra no pueden ser el mismo punto.');
    }

    const id = this.nextId('FIB');
    const seg: FiberSegment = {
      id,
      nombre: input.nombre?.trim() || id,
      tipoFibra: input.tipoFibra,
      hilos: input.hilos,
      origenId: input.origenId ?? null,
      destinoId: input.destinoId ?? null,
      origenDireccion: o.direccion,
      destinoDireccion: d.direccion,
      origen: { lng: o.lng, lat: o.lat },
      destino: { lng: d.lng, lat: d.lat },
      trazado: [
        [o.lng, o.lat],
        [d.lng, d.lat],
      ],
      longitud: Math.round(haversine(o.lat, o.lng, d.lat, d.lng)),
      creadoPor: input.creadoPor,
      creadoEn: new Date().toISOString(),
    };
    this.fiber.push(seg);
    this.persist(this.fiberFile, this.fiber);
    this.logger.log(`Fibra creada ${id} (${seg.longitud} m)`);
    return seg;
  }

  deleteFiber(id: string) {
    const i = this.fiber.findIndex((f) => f.id === id);
    if (i === -1) throw new NotFoundException('Fibra no encontrada.');
    this.fiber.splice(i, 1);
    this.persist(this.fiberFile, this.fiber);
    return { id };
  }

  // ---- topología (relaciones de dependencia) ----

  /** Conecta un activo a su padre (de qué depende). Rechaza ciclos. */
  setParent(id: string, parentId: string | null) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new NotFoundException('Activo no encontrado.');
    if (parentId) {
      const p = this.assets.find((x) => x.id === parentId);
      if (!p) throw new BadRequestException('El activo padre no existe.');
      if (parentId === id || this.descendantIds(id).has(parentId)) {
        throw new BadRequestException('Esa relación crearía un ciclo en la topología.');
      }
    }
    a.padreId = parentId;
    this.persist(this.assetsFile, this.assets);
    return a;
  }

  /** Cadena ascendente: del activo hasta la raíz (POP). */
  ancestors(id: string): Asset[] {
    const out: Asset[] = [];
    const byId = new Map(this.assets.map((a) => [a.id, a]));
    let cur = byId.get(id)?.padreId || null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur);
      if (!p) break;
      out.push(p);
      cur = p.padreId || null;
    }
    return out;
  }

  /** Ids de todos los descendientes (subárbol) de un activo. */
  private descendantIds(id: string): Set<string> {
    const children = new Map<string, string[]>();
    for (const a of this.assets) {
      if (a.padreId) {
        const arr = children.get(a.padreId) || [];
        arr.push(a.id);
        children.set(a.padreId, arr);
      }
    }
    const out = new Set<string>();
    const stack = [...(children.get(id) || [])];
    while (stack.length) {
      const c = stack.pop()!;
      if (out.has(c)) continue;
      out.add(c);
      for (const g of children.get(c) || []) stack.push(g);
    }
    return out;
  }

  /** Detalle completo de un activo: ficha + topología + capacidad + impacto. */
  getAssetDetail(id: string) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new NotFoundException('Activo no encontrado.');
    const desc = this.descendantIds(id);
    const descendientes = this.assets.filter((x) => desc.has(x.id));
    const padre = a.padreId ? this.assets.find((x) => x.id === a.padreId) || null : null;
    return {
      ...a,
      padre: padre ? { id: padre.id, nombre: padre.nombre, tipo: padre.tipo } : null,
      ancestros: this.ancestors(id).map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo })),
      descendientes: descendientes.map((d) => ({ id: d.id, nombre: d.nombre, tipo: d.tipo })),
      // Capacidad (semáforo R9) e impacto (clientes/NAPs/ingresos R14), del dominio probado.
      capacidad: this.capacityOf(a),
      impacto: this.impactOf(id),
      clientesDependientes: this.impactOf(id).clientesDependientes,
    };
  }

  // ---- helpers ----

  /** Resuelve un punto desde coordenada explícita o geocodificando la dirección. */
  private async resolvePoint(
    lng?: number,
    lat?: number,
    direccion?: string,
  ): Promise<{ lng: number; lat: number; direccion?: string }> {
    if (typeof lng === 'number' && typeof lat === 'number') {
      return { lng, lat, direccion };
    }
    if (direccion && direccion.trim().length >= 3) {
      const cands = await this.geo.geocode(direccion.trim());
      if (!cands.length) {
        throw new BadRequestException(`No se encontró la dirección: "${direccion}".`);
      }
      const c = cands[0];
      return { lng: c.lng, lat: c.lat, direccion: c.displayName };
    }
    throw new BadRequestException('Indica una dirección o una coordenada (lng, lat).');
  }

  /** Resuelve un extremo de fibra: por activo existente, por dirección o por coordenada. */
  private async resolveEndpoint(
    assetId?: string,
    direccion?: string,
    point?: { lng: number; lat: number },
  ): Promise<{ lng: number; lat: number; direccion?: string }> {
    if (assetId) {
      const a = this.assets.find((x) => x.id === assetId);
      if (!a) throw new BadRequestException(`Activo de fibra no encontrado: ${assetId}.`);
      return { lng: a.lng, lat: a.lat, direccion: a.direccion };
    }
    return this.resolvePoint(point?.lng, point?.lat, direccion);
  }

  private nextId(prefix: string): string {
    const pool = [...this.assets.map((a) => a.id), ...this.fiber.map((f) => f.id), ...this.sites.map((s) => s.id)];
    let max = 0;
    for (const id of pool) {
      const m = String(id).match(new RegExp(`^${prefix}-(\\d+)`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  private load<T>(file: string): T[] {
    try {
      if (!existsSync(file)) return [];
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch (e: any) {
      this.logger.warn(`No se pudo leer ${file}: ${e.message}`);
      return [];
    }
  }

  private persist(file: string, data: unknown) {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e: any) {
      this.logger.error(`No se pudo persistir ${file}: ${e.message}`);
    }
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
