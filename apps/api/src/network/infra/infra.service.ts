import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from '../../config';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import {
  PHOTO_CATEGORIES,
  type Asset,
  type AssetType,
  type Connection,
  type FiberSegment,
  type PhotoCategory,
  type PhotoRef,
  type Port,
  type PortRole,
  type PortState,
  type Site,
} from './domain/types';
import { semaphore as capSemaphore, freePorts } from './domain/capacity';
import { descendants as topoDescendants, dependentClients, type TopoNode } from './domain/topology';
import {
  evaluateConstruction as evalConstruction,
  type NapCandidate,
} from './domain/construction';
import {
  portStats as connPortStats,
  portSemaphore as connPortSemaphore,
  tracePath as connTracePath,
  type ConnLike,
  type PortLike,
} from './domain/connectivity';

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
  Poste: 'PST',
  ONU: 'ONU',
  Cliente: 'CL',
};

/**
 * Gemelo Digital de la Red — persistencia en PostgreSQL (Prisma) con un cache
 * en memoria hidratado al arrancar. La BD es la FUENTE DE VERDAD (integridad,
 * transacciones, junto al CRM); el cache mantiene las lecturas síncronas para
 * no cambiar la interfaz pública (controller, Customer360, UI). Migra una sola
 * vez los antiguos `infra-*.json` a la BD si la tabla está vacía.
 */
@Injectable()
export class InfraService implements OnModuleInit {
  private readonly logger = new Logger('InfraService');
  private assets: Asset[] = [];
  private fiber: FiberSegment[] = [];
  private sites: Site[] = [];
  private ports: Port[] = [];
  private connections: Connection[] = [];

  /** Tope DURO de longitud de acometida FTTH (metros). Más allá no hay cobertura. */
  private static readonly MAX_TENDIDO_M = 150;
  /** Caché de polígonos de alcance (Isochrone) por activo+coord+metros. */
  private readonly isochroneCache = new Map<string, any>();

  private readonly dir = resolve(process.cwd(), config.geo.dataDir);
  private readonly uploadsDir = resolve(this.dir, 'uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
  ) {}

  async onModuleInit() {
    await this.migrateJsonIfNeeded();
    await this.hydrate();
    this.logger.log(
      `Infra (PostgreSQL): ${this.assets.length} activos · ${this.fiber.length} fibras · ${this.sites.length} sitios · ${this.ports.length} puertos · ${this.connections.length} conexiones`,
    );
  }

  /** Carga el cache desde la BD. */
  private async hydrate() {
    const [assets, fiber, sites] = await Promise.all([
      this.prisma.activo.findMany({ orderBy: { creadoEn: 'asc' } }),
      this.prisma.segmentoFibra.findMany({ orderBy: { creadoEn: 'asc' } }),
      this.prisma.sitio.findMany({ orderBy: { creadoEn: 'asc' } }),
    ]);
    this.assets = assets.map(rowToAsset);
    this.fiber = fiber.map(rowToFiber);
    this.sites = sites.map(rowToSite);

    // Conectividad (Fase puerto). Tolerante a que las tablas aún no existan
    // (antes de `prisma db push`): el resto del módulo sigue operativo.
    try {
      const [ports, connections] = await Promise.all([
        this.prisma.puerto.findMany({ orderBy: [{ activoId: 'asc' }, { numero: 'asc' }] }),
        this.prisma.conexion.findMany({ orderBy: { creadoEn: 'asc' } }),
      ]);
      this.ports = ports.map(rowToPort);
      this.connections = connections.map(rowToConnection);
    } catch (e: any) {
      this.ports = [];
      this.connections = [];
      this.logger.warn(
        `Conectividad no hidratada (¿falta "prisma db push" de puerto/conexion?): ${e.message}`,
      );
    }
  }

  /**
   * Importa los antiguos JSON a la BD una sola vez (si la tabla `activo` está
   * vacía y existe `infra-assets.json`). Tras importar, renombra los archivos a
   * `.imported` para no reimportar y dejar respaldo.
   */
  private async migrateJsonIfNeeded() {
    try {
      const count = await this.prisma.activo.count();
      if (count > 0) return;

      const assetsFile = resolve(this.dir, 'infra-assets.json');
      const fiberFile = resolve(this.dir, 'infra-fiber.json');
      const sitesFile = resolve(this.dir, 'infra-sites.json');

      const jAssets = readJson<Asset>(assetsFile);
      const jFiber = readJson<FiberSegment>(fiberFile);
      const jSites = readJson<Site>(sitesFile);
      if (!jAssets.length && !jFiber.length && !jSites.length) return;

      for (const a of jAssets) {
        await this.prisma.activo.create({ data: assetToRow(a) }).catch(() => undefined);
      }
      for (const f of jFiber) {
        await this.prisma.segmentoFibra.create({ data: fiberToRow(f) }).catch(() => undefined);
      }
      for (const s of jSites) {
        await this.prisma.sitio.create({ data: siteToRow(s) }).catch(() => undefined);
      }
      this.logger.log(
        `Migrados a PostgreSQL: ${jAssets.length} activos · ${jFiber.length} fibras · ${jSites.length} sitios (desde JSON).`,
      );
      for (const f of [assetsFile, fiberFile, sitesFile]) {
        try {
          if (existsSync(f)) renameSync(f, f + '.imported');
        } catch {
          /* respaldo best-effort */
        }
      }
    } catch (e: any) {
      this.logger.warn(`Migración JSON→BD omitida: ${e.message}`);
    }
  }

  // ---- lectura (desde cache) ----
  listAssets() {
    return this.assets;
  }

  /**
   * Instantánea de datos crudos para el Motor de Red (grafo unificado,
   * simulación e ingeniería óptica). Desacopla el motor del plumbing de datos:
   * el motor solo consume estructuras, no toca Prisma ni el cache directamente.
   */
  snapshot(): { assets: Asset[]; fiber: FiberSegment[]; ports: Port[]; connections: Connection[] } {
    return {
      assets: this.assets,
      fiber: this.fiber,
      ports: this.ports,
      connections: this.connections,
    };
  }
  listFiber() {
    return this.fiber;
  }
  listSites() {
    return this.sites;
  }

  /**
   * NAP/CTO del inventario (fuente de verdad del editor GIS) con su capacidad
   * real, para que la consulta de cobertura y el "NAP más cercano" del Mapa
   * reflejen lo que se construye en Infraestructura. No fabrica nada: deriva de
   * los activos registrados y su ocupación de puertos.
   */
  getNapPoints(): { id: string; nombre: string; lng: number; lat: number; total: number; usados: number; libres: number }[] {
    const out: { id: string; nombre: string; lng: number; lat: number; total: number; usados: number; libres: number }[] = [];
    for (const a of this.assets) {
      const t = a.tipo as string;
      if (t !== 'NAP' && t !== 'CTO') continue;
      const cap = this.capacityOf(a);
      out.push({
        id: a.id, nombre: a.nombre, lng: a.lng, lat: a.lat,
        total: cap?.total ?? 0, usados: cap?.usados ?? 0, libres: cap?.libres ?? 0,
      });
    }
    return out;
  }

  /** Proyección a nodos de topología (grafo padreId) para los helpers de dominio. */
  private topoNodes(): TopoNode[] {
    return this.assets.map((a) => ({ id: a.id, padreId: a.padreId ?? null, tipo: a.tipo }));
  }

  /** Capacidad de un activo (NAP/CTO). Prefiere puertos REALES; si no hay, usa el contador de atributos. null si no aplica. */
  private capacityOf(a: Asset): { total: number; usados: number; libres: number; semaforo: string } | null {
    if (a.tipo !== 'NAP') return null;

    // 1) Fuente de verdad: puertos físicos registrados (ocupación real derivada).
    const realPorts = this.ports.filter((p) => p.activoId === a.id);
    if (realPorts.length > 0) {
      const stats = connPortStats(realPorts as PortLike[]);
      return {
        total: stats.total,
        usados: stats.total - stats.libres,
        libres: stats.libres,
        semaforo: connPortSemaphore(stats),
      };
    }

    // 2) Respaldo: contador manual en atributos (compatibilidad con NAPs sin puertos).
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
   * reales. Prefiltra por cercanía (haversine) y refina con distancia REAL por
   * calle (Matrix) para una viabilidad fiel. Devuelve NAP, viabilidad y costos.
   */
  async evaluateConstruction(lng: number, lat: number) {
    const MAX = InfraService.MAX_TENDIDO_M; // tope duro de tendido (150 m)
    const naps = this.assets.filter((a) => a.tipo === 'NAP');
    // Prefiltro barato: las 8 NAP más cercanas en línea recta.
    const top = naps
      .map((a) => ({ a, h: haversine(lat, lng, a.lat, a.lng) }))
      .sort((x, y) => x.h - y.h)
      .slice(0, 8);

    // Distancia REAL por calle a las candidatas (Matrix). Si falla, usa haversine.
    let roads: (number | null)[] | null = null;
    try {
      roads = await this.geo.travelDistances({ lng, lat }, top.map((t) => ({ lng: t.a.lng, lat: t.a.lat })));
    } catch { roads = null; }

    const candidates: (NapCandidate & { nombre: string; lng: number; lat: number })[] = top.map((t, i) => {
      const cap = this.capacityOf(t.a);
      const road = roads && typeof roads[i] === 'number' ? (roads[i] as number) : null;
      // distanciaMax SIEMPRE acotada al tope duro de 150 m (aunque la NAP declare más).
      const distanciaMax = Math.min(MAX, Number(t.a.atributos?.distanciaMax) || MAX);
      return {
        id: t.a.id,
        nombre: t.a.nombre,
        lng: t.a.lng,
        lat: t.a.lat,
        puertosLibres: cap?.libres ?? 0,
        distanciaTendido: road ?? Math.round(t.h),
        distanciaMax,
      };
    });

    const evalr = evalConstruction(candidates);
    const nap = evalr.nap ? candidates.find((c) => c.id === evalr.nap!.id) || null : null;

    return {
      punto: { lng, lat },
      resultado: evalr.resultado,
      causa: evalr.causa,
      distanciaTendido: evalr.distanciaTendido,
      maxTendido: MAX,
      puertosLibres: evalr.puertosLibres,
      costoEstimado: evalr.costoEstimado,
      tiempoEstimadoDias: evalr.tiempoEstimadoDias,
      nap: nap
        ? { id: nap.id, nombre: nap.nombre, lng: nap.lng, lat: nap.lat, distanciaMax: nap.distanciaMax }
        : null,
    };
  }

  /** Polígono de alcance de tendido (Isochrone) de una NAP/activo, acotado a 150 m. */
  async isochroneForAsset(id: string, metros?: number) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new NotFoundException('Activo no encontrado.');
    const m = Math.min(InfraService.MAX_TENDIDO_M, metros || Number(a.atributos?.distanciaMax) || InfraService.MAX_TENDIDO_M);
    const isochrone = await this.isochroneCached(a.id, a.lng, a.lat, m);
    return { id, metros: m, centro: { lng: a.lng, lat: a.lat }, isochrone };
  }

  /** Isochrone con caché por activo+coord+metros (estable mientras la NAP no se mueva). */
  private async isochroneCached(id: string, lng: number, lat: number, metros: number): Promise<any | null> {
    const key = `${id}|${lng.toFixed(6)}|${lat.toFixed(6)}|${metros}`;
    if (this.isochroneCache.has(key)) return this.isochroneCache.get(key);
    const fc = await this.geo.isochrone(lng, lat, metros);
    if (fc) this.isochroneCache.set(key, fc);
    return fc;
  }

  /**
   * Cobertura REAL de toda la planta: une los polígonos de alcance (Isochrone a
   * 150 m por calle) de TODAS las NAP. Cada feature trae napId, nombre, puertos
   * libres y semáforo, para pintar disponibilidad. Resultado cacheado por NAP.
   */
  async coverageIsochrones(metros?: number) {
    const m = Math.min(InfraService.MAX_TENDIDO_M, metros || InfraService.MAX_TENDIDO_M);
    const naps = this.assets.filter((a) => a.tipo === 'NAP').slice(0, 80);
    const features: any[] = [];
    const results = await Promise.all(
      naps.map(async (a) => {
        const cap = this.capacityOf(a);
        const fc = await this.isochroneCached(a.id, a.lng, a.lat, m);
        return { a, cap, fc };
      }),
    );
    for (const { a, cap, fc } of results) {
      if (!fc?.features?.length) continue;
      const libres = cap?.libres ?? 0;
      const total = cap?.total ?? 0;
      const sem = total === 0 || libres <= 0 ? 'rojo' : libres / total <= 0.25 ? 'amarillo' : 'verde';
      for (const f of fc.features) {
        features.push({
          ...f,
          properties: { ...(f.properties || {}), napId: a.id, nombre: a.nombre, libres, total, sem },
        });
      }
    }
    return { metros: m, naps: naps.length, isochrones: { type: 'FeatureCollection', features } };
  }


  /**
   * Motor de asignación: rankea las NAP candidatas para un punto (alta de
   * cliente). Viables primero (puertos libres ≥ 1 Y dentro del alcance de
   * tendido), luego por distancia. Cada candidata trae su causa de inviabilidad.
   */
  suggestNaps(lng: number, lat: number, limit = 6) {
    const naps = this.assets
      .filter((a) => a.tipo === 'NAP')
      .map((a) => {
        const cap = this.capacityOf(a);
        const distancia = Math.round(haversine(lat, lng, a.lat, a.lng));
        // distanciaMax SIEMPRE acotada al tope duro de 150 m (aunque la NAP declare más).
        const distanciaMax = Math.min(
          InfraService.MAX_TENDIDO_M,
          Number(a.atributos?.distanciaMax) || InfraService.MAX_TENDIDO_M,
        );
        const libres = cap?.libres ?? 0;
        const dentroAlcance = distancia <= distanciaMax;
        const viable = libres >= 1 && dentroAlcance;
        const causa = !dentroAlcance ? 'fuera_de_alcance' : libres < 1 ? 'sin_puertos' : null;
        return {
          id: a.id,
          nombre: a.nombre,
          lng: a.lng,
          lat: a.lat,
          distancia,
          distanciaMax,
          puertosTotal: cap?.total ?? null,
          puertosUsados: cap?.usados ?? null,
          puertosLibres: libres,
          semaforo: cap?.semaforo ?? null,
          viable,
          causa,
        };
      });
    naps.sort((a, b) => Number(b.viable) - Number(a.viable) || a.distancia - b.distancia);
    return naps.slice(0, limit);
  }

  /** Bundle GeoJSON para pintar la red real en el mapa. */
  getBundle() {    const nodes = this.topoNodes();
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
              fotosCount: a.fotos?.length ?? 0,
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
    await this.prisma.activo.create({ data: assetToRow(asset) });
    this.assets.push(asset);

    // Si es una NAP con capacidad declarada, materializa sus puertos físicos
    // (la ocupación real se derivará de ellos, no del contador).
    const total = Number(asset.atributos?.puertosTotal ?? asset.atributos?.puertos_total ?? 0);
    if (asset.tipo === 'NAP' && Number.isFinite(total) && total >= 1) {
      await this.generatePorts(id, Math.min(total, 1024), 'salida').catch((e) =>
        this.logger.warn(`No se pudieron generar puertos de ${id}: ${e.message}`),
      );
    }

    this.logger.log(`Activo creado ${id} (${asset.tipo}) @ [${lng}, ${lat}]`);
    return asset;
  }

  /**
   * Edición puntual de un activo (renombrar, corregir dirección/estado o datos
   * de placa). Solo toca los campos enviados; el resto queda intacto. Persiste
   * en BD y refresca la copia en memoria.
   */
  async updateAsset(
    id: string,
    patch: {
      nombre?: string;
      direccion?: string;
      estado?: string;
      marca?: string;
      modelo?: string;
      serie?: string;
    },
  ): Promise<Asset> {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new NotFoundException('Activo no encontrado.');

    const data: Record<string, any> = {};
    if (patch.nombre !== undefined) {
      const nombre = patch.nombre.trim();
      if (!nombre) throw new BadRequestException('El nombre no puede quedar vacío.');
      a.nombre = nombre;
      data.nombre = nombre;
    }
    if (patch.direccion !== undefined) {
      const dir = patch.direccion.trim() || null;
      a.direccion = dir ?? undefined;
      data.direccion = dir;
    }
    if (patch.estado !== undefined) { a.estado = patch.estado as any; data.estado = patch.estado; }
    if (patch.marca !== undefined) { a.marca = patch.marca || undefined; data.marca = patch.marca || null; }
    if (patch.modelo !== undefined) { a.modelo = patch.modelo || undefined; data.modelo = patch.modelo || null; }
    if (patch.serie !== undefined) { a.serie = patch.serie || undefined; data.serie = patch.serie || null; }

    if (Object.keys(data).length) {
      await this.prisma.activo.update({ where: { id }, data });
      this.logger.log(`Activo actualizado ${id} (${Object.keys(data).join(', ')})`);
    }
    return a;
  }

  async deleteAsset(id: string) {
    const i = this.assets.findIndex((a) => a.id === id);
    if (i === -1) throw new NotFoundException('Activo no encontrado.');
    await this.prisma.activo.delete({ where: { id } });
    this.assets.splice(i, 1);

    // Limpia la conectividad asociada (puertos del activo + conexiones que los usan).
    const portIds = this.ports.filter((p) => p.activoId === id).map((p) => p.id);
    if (portIds.length) {
      const portSet = new Set(portIds);
      await this.prisma.conexion
        .deleteMany({ where: { OR: [{ aPuertoId: { in: portIds } }, { bPuertoId: { in: portIds } }] } })
        .catch(() => undefined);
      await this.prisma.puerto.deleteMany({ where: { activoId: id } }).catch(() => undefined);
      this.connections = this.connections.filter(
        (c) => !portSet.has(c.aPuertoId) && !(c.bPuertoId && portSet.has(c.bPuertoId)),
      );
      this.ports = this.ports.filter((p) => p.activoId !== id);
    }

    try {
      const folder = resolve(this.uploadsDir, id);
      if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
    } catch (e: any) {
      this.logger.warn(`No se pudo borrar la evidencia de ${id}: ${e.message}`);
    }
    return { id };
  }

  // ---- evidencia fotográfica (vista de calle propia, georreferenciada) ----

  async addPhoto(
    assetId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    categoria: string,
    autor?: string,
  ): Promise<{ asset: Asset; foto: PhotoRef }> {
    const asset = this.assets.find((a) => a.id === assetId);
    if (!asset) throw new NotFoundException('Activo no encontrado.');
    if (!file?.buffer?.length) throw new BadRequestException('No se recibió ninguna imagen.');

    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('Formato no soportado. Usa JPG, PNG o WebP.');
    const cat: PhotoCategory = (PHOTO_CATEGORIES as string[]).includes(categoria)
      ? (categoria as PhotoCategory)
      : 'vista_general';

    const folder = resolve(this.uploadsDir, assetId);
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

    const fileId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const filename = `${fileId}.${ext}`;
    writeFileSync(resolve(folder, filename), file.buffer);

    const foto: PhotoRef = {
      id: fileId,
      categoria: cat,
      url: `/api/uploads/${assetId}/${filename}`,
      subidoEn: new Date().toISOString(),
      autor,
    };
    asset.fotos = [...(asset.fotos || []), foto];
    await this.prisma.activo.update({ where: { id: assetId }, data: { fotos: asset.fotos as any } });
    this.logger.log(`Evidencia añadida a ${assetId}: ${cat} (${Math.round(file.size / 1024)} KB)`);
    return { asset, foto };
  }

  async removePhoto(assetId: string, photoId: string): Promise<{ id: string }> {
    const asset = this.assets.find((a) => a.id === assetId);
    if (!asset) throw new NotFoundException('Activo no encontrado.');
    const foto = asset.fotos?.find((f) => f.id === photoId);
    if (!foto) throw new NotFoundException('Foto no encontrada.');
    asset.fotos = (asset.fotos || []).filter((f) => f.id !== photoId);
    await this.prisma.activo.update({ where: { id: assetId }, data: { fotos: asset.fotos as any } });
    try {
      const filename = foto.url.split('/').pop() || '';
      const abs = resolve(this.uploadsDir, assetId, filename);
      if (filename && existsSync(abs)) rmSync(abs, { force: true });
    } catch (e: any) {
      this.logger.warn(`No se pudo borrar el archivo de ${photoId}: ${e.message}`);
    }
    return { id: photoId };
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
    /** Trazado real poste a poste [[lng,lat], ...]. Si llega, manda sobre los extremos rectos. */
    trazado?: number[][];
    /** Si true y no hay trazado manual, rutea el tramo siguiendo las calles (Directions). */
    rutearPorCalle?: boolean;
    creadoPor?: string;
  }): Promise<FiberSegment> {
    // Polilínea trazada en el mapa (poste a poste). Sanitiza y descarta duplicados consecutivos.
    const path = sanitizePath(input.trazado);

    let o: { lng: number; lat: number; direccion?: string };
    let d: { lng: number; lat: number; direccion?: string };
    let coords: number[][];

    if (path.length >= 2) {
      // Trazado real: los extremos son el primer y último vértice. Si además se
      // referencia un activo en un extremo, se "pega" (snap) a su coordenada exacta.
      o = { lng: path[0][0], lat: path[0][1], direccion: input.origenDireccion };
      d = { lng: path[path.length - 1][0], lat: path[path.length - 1][1], direccion: input.destinoDireccion };
      if (input.origenId) { const e = await this.resolveEndpoint(input.origenId); o = e; path[0] = [e.lng, e.lat]; }
      if (input.destinoId) { const e = await this.resolveEndpoint(input.destinoId); d = e; path[path.length - 1] = [e.lng, e.lat]; }
      coords = path;
    } else {
      // Modo clásico: dos extremos (activo / dirección / coordenada).
      o = await this.resolveEndpoint(input.origenId, input.origenDireccion, input.origen);
      d = await this.resolveEndpoint(input.destinoId, input.destinoDireccion, input.destino);
      coords = [
        [o.lng, o.lat],
        [d.lng, d.lat],
      ];
      // Ruteo por calles: la fibra sigue las vías reales (longitud y trazado
      // realistas) en vez de una recta. Los extremos se fijan a los activos.
      if (input.rutearPorCalle) {
        const r = await this.geo.routeAlongStreets({ lng: o.lng, lat: o.lat }, { lng: d.lng, lat: d.lat });
        if (r && r.coords.length >= 2) {
          const c = r.coords.map((p) => [p[0], p[1]]);
          c[0] = [o.lng, o.lat];
          c[c.length - 1] = [d.lng, d.lat];
          coords = c;
        }
      }
    }

    if (o.lng === d.lng && o.lat === d.lat && coords.length < 2) {
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
      trazado: coords,
      // Longitud REAL = suma de los tramos de la polilínea (no la recta extremo-a-extremo).
      longitud: Math.round(pathLength(coords)),
      creadoPor: input.creadoPor,
      creadoEn: new Date().toISOString(),
    };
    await this.prisma.segmentoFibra.create({ data: fiberToRow(seg) });
    this.fiber.push(seg);
    this.logger.log(`Fibra creada ${id} (${seg.longitud} m · ${coords.length} vértices)`);
    return seg;
  }

  async deleteFiber(id: string) {
    const i = this.fiber.findIndex((f) => f.id === id);
    if (i === -1) throw new NotFoundException('Fibra no encontrada.');
    await this.prisma.segmentoFibra.delete({ where: { id } });
    this.fiber.splice(i, 1);
    return { id };
  }

  /**
   * Reedita el TRAZADO de un tramo de fibra (mover vértices / reanclar a postes).
   * Recibe la polilínea completa [[lng,lat],…]. Si un extremo está enlazado a un
   * activo (origenId/destinoId), ese vértice se fija a la coordenada exacta del
   * activo. Recalcula la longitud real y persiste.
   */
  async updateFiber(
    id: string,
    input: { trazado: number[][]; origenId?: string | null; destinoId?: string | null },
  ): Promise<FiberSegment> {
    const seg = this.fiber.find((f) => f.id === id);
    if (!seg) throw new NotFoundException('Fibra no encontrada.');

    const path = sanitizePath(input.trazado);
    if (path.length < 2) {
      throw new BadRequestException('El trazado debe tener al menos dos vértices.');
    }

    // Reanclaje de extremos: si se enlaza a un activo, el vértice se pega a él.
    const origenId = input.origenId === undefined ? seg.origenId : input.origenId;
    const destinoId = input.destinoId === undefined ? seg.destinoId : input.destinoId;
    if (origenId) { const e = await this.resolveEndpoint(origenId); path[0] = [e.lng, e.lat]; }
    if (destinoId) { const e = await this.resolveEndpoint(destinoId); path[path.length - 1] = [e.lng, e.lat]; }

    seg.trazado = path;
    seg.origen = { lng: path[0][0], lat: path[0][1] };
    seg.destino = { lng: path[path.length - 1][0], lat: path[path.length - 1][1] };
    seg.origenId = origenId ?? null;
    seg.destinoId = destinoId ?? null;
    seg.longitud = Math.round(pathLength(path));

    await this.prisma.segmentoFibra.update({
      where: { id },
      data: {
        trazado: path as any,
        longitud: seg.longitud,
        origenId: seg.origenId,
        destinoId: seg.destinoId,
        origenLng: seg.origen.lng,
        origenLat: seg.origen.lat,
        destinoLng: seg.destino.lng,
        destinoLat: seg.destino.lat,
      },
    });
    this.logger.log(`Fibra actualizada ${id} (${seg.longitud} m · ${path.length} vértices)`);
    return seg;
  }

  // ---- topología (relaciones de dependencia) ----

  /** Conecta un activo a su padre (de qué depende). Rechaza ciclos. */
  async setParent(id: string, parentId: string | null) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new NotFoundException('Activo no encontrado.');
    if (parentId) {
      const p = this.assets.find((x) => x.id === parentId);
      if (!p) throw new BadRequestException('El activo padre no existe.');
      if (parentId === id || this.descendantIds(id).has(parentId)) {
        throw new BadRequestException('Esa relación crearía un ciclo en la topología.');
      }
    }
    await this.prisma.activo.update({ where: { id }, data: { padreId: parentId } });
    a.padreId = parentId;
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
      capacidad: this.capacityOf(a),
      puertos: this.portsDetail(id),
      trazado: this.tracePath(id),
      impacto: this.impactOf(id),
      clientesDependientes: this.impactOf(id).clientesDependientes,
    };
  }

  // ---- conectividad a nivel de puerto (Fase puerto) ----

  /** Puertos de un activo (orden por número). */
  listPorts(activoId: string): Port[] {
    return this.ports
      .filter((p) => p.activoId === activoId)
      .sort((a, b) => a.numero - b.numero);
  }

  /** Conexión activa que ocupa un puerto (como origen o destino), si existe. */
  private connectionOfPort(puertoId: string): Connection | undefined {
    return this.connections.find(
      (c) => c.estado === 'activa' && (c.aPuertoId === puertoId || c.bPuertoId === puertoId),
    );
  }

  /** Detalle de puertos + ocupación de un activo (para la ficha). */
  portsDetail(activoId: string) {
    const asset = this.assets.find((a) => a.id === activoId);
    if (!asset) throw new NotFoundException('Activo no encontrado.');
    const ports = this.listPorts(activoId);
    const stats = connPortStats(ports as PortLike[]);
    return {
      activoId,
      stats: { ...stats, semaforo: connPortSemaphore(stats) },
      puertos: ports.map((p) => {
        const conn = this.connectionOfPort(p.id);
        return {
          id: p.id,
          numero: p.numero,
          rol: p.rol,
          estado: p.estado,
          etiqueta: p.etiqueta ?? null,
          conexion: conn
            ? {
                id: conn.id,
                servicioId: conn.servicioId ?? null,
                bPuertoId: conn.bPuertoId ?? null,
                hilo: conn.hilo ?? null,
                segmentoFibraId: conn.segmentoFibraId ?? null,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Genera puertos para un activo (NAP/OLT/Splitter). Idempotente por
   * (activo, rol, número): crea solo los que falten hasta `total`. Útil al dar
   * de alta una NAP de N puertos.
   */
  async generatePorts(
    activoId: string,
    total: number,
    rol: PortRole = 'salida',
  ): Promise<{ creados: number; total: number }> {
    const asset = this.assets.find((a) => a.id === activoId);
    if (!asset) throw new NotFoundException('Activo no encontrado.');
    if (!Number.isInteger(total) || total < 1 || total > 1024) {
      throw new BadRequestException('El total de puertos debe estar entre 1 y 1024.');
    }
    const existing = new Set(
      this.ports.filter((p) => p.activoId === activoId && p.rol === rol).map((p) => p.numero),
    );
    let creados = 0;
    for (let n = 1; n <= total; n++) {
      if (existing.has(n)) continue;
      const row = await this.prisma.puerto.create({
        data: { activoId, numero: n, rol, estado: 'libre' },
      });
      this.ports.push(rowToPort(row));
      creados++;
    }
    // Sincroniza el contador de atributos para compatibilidad con vistas antiguas.
    asset.atributos = { ...(asset.atributos || {}), puertosTotal: this.listPorts(activoId).length };
    await this.prisma.activo
      .update({ where: { id: activoId }, data: { atributos: asset.atributos as any } })
      .catch(() => undefined);
    this.logger.log(`Puertos generados en ${activoId}: +${creados} (total ${this.listPorts(activoId).length})`);
    return { creados, total: this.listPorts(activoId).length };
  }

  /**
   * Conecta un puerto a un servicio (cliente terminal) o a otro puerto
   * (cadena Splitter→NAP / OLT→Splitter). Marca el puerto como ocupado.
   */
  async connectPort(
    puertoId: string,
    input: { servicioId?: string; bPuertoId?: string; hilo?: number; segmentoFibraId?: string; creadoPor?: string },
  ): Promise<Connection> {
    const port = this.ports.find((p) => p.id === puertoId);
    if (!port) throw new NotFoundException('Puerto no encontrado.');
    if (port.estado === 'ocupado') {
      throw new BadRequestException(`El puerto ${port.numero} ya está ocupado.`);
    }
    if (port.estado === 'dañado') {
      throw new BadRequestException(`El puerto ${port.numero} está marcado como dañado.`);
    }
    if (!input.servicioId && !input.bPuertoId) {
      throw new BadRequestException('Indica un servicio (cliente) o un puerto destino para conectar.');
    }
    if (input.bPuertoId) {
      const b = this.ports.find((p) => p.id === input.bPuertoId);
      if (!b) throw new BadRequestException('El puerto destino no existe.');
      if (b.id === port.id) throw new BadRequestException('Un puerto no puede conectarse a sí mismo.');
    }

    const row = await this.prisma.conexion.create({
      data: {
        aPuertoId: puertoId,
        bPuertoId: input.bPuertoId ?? null,
        servicioId: input.servicioId ?? null,
        hilo: input.hilo ?? null,
        segmentoFibraId: input.segmentoFibraId ?? null,
        estado: 'activa',
        creadoPor: input.creadoPor ?? null,
      },
    });
    const conn = rowToConnection(row);
    this.connections.push(conn);

    // Ambos extremos quedan ocupados.
    await this.setPortState(port.id, 'ocupado');
    if (input.bPuertoId) await this.setPortState(input.bPuertoId, 'ocupado');

    // Si terminó en un servicio, deja la traza en el servicio (napId/puerto).
    if (input.servicioId) {
      await this.prisma.servicio
        .update({
          where: { id: input.servicioId },
          data: { activoNapId: port.activoId, napId: port.activoId, puerto: port.numero },
        })
        .catch(() => undefined);
    }
    this.logger.log(`Puerto ${port.activoId}#${port.numero} conectado (${input.servicioId ? 'servicio' : 'puerto'}).`);
    return conn;
  }

  /** Libera un puerto: desactiva su conexión y vuelve a 'libre' (ambos extremos). */
  async disconnectPort(puertoId: string): Promise<{ id: string }> {
    const port = this.ports.find((p) => p.id === puertoId);
    if (!port) throw new NotFoundException('Puerto no encontrado.');
    const conn = this.connectionOfPort(puertoId);
    if (conn) {
      await this.prisma.conexion.delete({ where: { id: conn.id } }).catch(() => undefined);
      this.connections = this.connections.filter((c) => c.id !== conn.id);
      if (conn.servicioId) {
        await this.prisma.servicio
          .update({ where: { id: conn.servicioId }, data: { puerto: null } })
          .catch(() => undefined);
      }
      await this.setPortState(conn.aPuertoId, 'libre');
      if (conn.bPuertoId) await this.setPortState(conn.bPuertoId, 'libre');
    } else {
      await this.setPortState(puertoId, 'libre');
    }
    return { id: puertoId };
  }

  /** Cambia el estado de un puerto (cache + BD). */
  private async setPortState(puertoId: string, estado: PortState) {
    const p = this.ports.find((x) => x.id === puertoId);
    if (!p) return;
    p.estado = estado;
    await this.prisma.puerto.update({ where: { id: puertoId }, data: { estado } }).catch(() => undefined);
  }

  /**
   * Trazado óptico: desde un activo (o el NAP de un servicio) hasta la raíz
   * (POP/OLT), anotando el puerto e hilo usados en cada salto. Combina la cadena
   * topológica (ancestros por padreId) con las conexiones puerto↔puerto.
   */
  tracePath(assetId: string) {
    const start = this.assets.find((a) => a.id === assetId);
    if (!start) throw new NotFoundException('Activo no encontrado.');
    const chain = [start.id, ...this.ancestors(assetId).map((a) => a.id)];

    const portsByAsset = new Map<string, PortLike[]>();
    for (const id of chain) {
      portsByAsset.set(id, this.listPorts(id) as PortLike[]);
    }
    const hops = connTracePath(chain, portsByAsset, this.connections as ConnLike[]);
    const byId = new Map(this.assets.map((a) => [a.id, a]));
    return {
      origen: { id: start.id, nombre: start.nombre, tipo: start.tipo },
      saltos: hops.map((h) => {
        const a = byId.get(h.activoId);
        return {
          id: h.activoId,
          nombre: a?.nombre ?? h.activoId,
          tipo: a?.tipo ?? '?',
          lng: a?.lng,
          lat: a?.lat,
          puerto: h.puertoNumero ?? null,
          hilo: h.hilo ?? null,
          segmentoFibraId: h.segmentoFibraId ?? null,
        };
      }),
    };
  }

  /**
   * Exporta la red en el formato OFDS (Open Fibre Data Standard): activos →
   * `nodes` (Point) y segmentos de fibra → `spans` (LineString). Habilita
   * interoperabilidad con herramientas que consumen el estándar abierto.
   */
  exportOfds() {
    return {
      networks: [
        {
          id: 'cicanet',
          name: 'CICANET',
          nodes: this.assets.map((a) => ({
            id: a.id,
            name: a.nombre,
            // Mapeo de tipo CICANET → fenómeno físico OFDS (aproximado).
            physicalInfrastructureProvider: a.propio ? 'CICANET' : a.regimen || 'Tercero',
            type: a.tipo,
            status: a.estado,
            location: { type: 'Point', coordinates: [a.lng, a.lat] },
          })),
          spans: this.fiber.map((f) => ({
            id: f.id,
            name: f.nombre ?? f.id,
            start: f.origenId ?? null,
            end: f.destinoId ?? null,
            physicalInfrastructureProvider: 'CICANET',
            fibreCount: f.hilos ?? null,
            fibreType: f.tipoFibra ?? null,
            route: { type: 'LineString', coordinates: f.trazado },
          })),
        },
      ],
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
      // Posición EXACTA del clic. Si el operador no escribió dirección, se captura
      // automáticamente por reverse-geocoding del punto exacto (Google/Mapbox/OSM).
      let dir = direccion && direccion.trim() ? direccion.trim() : undefined;
      if (!dir) {
        try { dir = (await this.geo.reverse(lat, lng)) ?? undefined; }
        catch { /* sin dirección si el reverse falla; las coordenadas mandan */ }
      }
      return { lng, lat, direccion: dir };
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
}

// ===========================================================================
//  Mapeo fila(Prisma) ↔ dominio
// ===========================================================================

function rowToAsset(r: any): Asset {
  return {
    id: r.id,
    tipo: r.tipo,
    nombre: r.nombre,
    marca: r.marca ?? undefined,
    modelo: r.modelo ?? undefined,
    serie: r.serie ?? undefined,
    direccion: r.direccion ?? undefined,
    barrio: r.barrio ?? undefined,
    comuna: r.comuna ?? undefined,
    ciudad: r.ciudad ?? undefined,
    lng: r.lng,
    lat: r.lat,
    estado: r.estado,
    propio: r.propio,
    regimen: r.regimen ?? undefined,
    padreId: r.padreId ?? null,
    sitioId: r.sitioId ?? null,
    planMensual: r.planMensual ?? undefined,
    atributos: (r.atributos as Record<string, any>) ?? {},
    fotos: (r.fotos as PhotoRef[]) ?? undefined,
    documentos: (r.documentos as any) ?? undefined,
    historial: (r.historial as any) ?? undefined,
    creadoPor: r.creadoPor ?? undefined,
    creadoEn: (r.creadoEn instanceof Date ? r.creadoEn.toISOString() : r.creadoEn) ?? new Date().toISOString(),
  };
}

function assetToRow(a: Asset): any {
  return {
    id: a.id,
    tipo: a.tipo,
    nombre: a.nombre,
    marca: a.marca ?? null,
    modelo: a.modelo ?? null,
    serie: a.serie ?? null,
    direccion: a.direccion ?? null,
    barrio: a.barrio ?? null,
    comuna: a.comuna ?? null,
    ciudad: a.ciudad ?? null,
    lng: a.lng,
    lat: a.lat,
    estado: a.estado || 'Activo',
    propio: a.propio !== false,
    regimen: a.regimen ?? null,
    padreId: a.padreId ?? null,
    sitioId: a.sitioId ?? null,
    planMensual: a.planMensual ?? null,
    atributos: (a.atributos ?? {}) as any,
    fotos: (a.fotos ?? []) as any,
    documentos: (a.documentos ?? []) as any,
    historial: (a.historial ?? []) as any,
    creadoPor: a.creadoPor ?? null,
    ...(a.creadoEn ? { creadoEn: new Date(a.creadoEn) } : {}),
  };
}

function rowToFiber(r: any): FiberSegment {
  const trazado = (r.trazado as number[][]) ?? [
    [r.origenLng, r.origenLat],
    [r.destinoLng, r.destinoLat],
  ];
  return {
    id: r.id,
    nombre: r.nombre ?? undefined,
    tipoFibra: r.tipoFibra ?? undefined,
    hilos: r.hilos ?? undefined,
    origenId: r.origenId ?? null,
    destinoId: r.destinoId ?? null,
    origenDireccion: r.origenDireccion ?? undefined,
    destinoDireccion: r.destinoDireccion ?? undefined,
    origen: { lng: r.origenLng, lat: r.origenLat },
    destino: { lng: r.destinoLng, lat: r.destinoLat },
    trazado,
    longitud: r.longitud,
    creadoPor: r.creadoPor ?? undefined,
    creadoEn: (r.creadoEn instanceof Date ? r.creadoEn.toISOString() : r.creadoEn) ?? new Date().toISOString(),
  };
}

function fiberToRow(f: FiberSegment): any {
  return {
    id: f.id,
    nombre: f.nombre ?? null,
    tipoFibra: f.tipoFibra ?? null,
    hilos: f.hilos ?? null,
    origenId: f.origenId ?? null,
    destinoId: f.destinoId ?? null,
    origenDireccion: f.origenDireccion ?? null,
    destinoDireccion: f.destinoDireccion ?? null,
    origenLng: f.origen.lng,
    origenLat: f.origen.lat,
    destinoLng: f.destino.lng,
    destinoLat: f.destino.lat,
    trazado: (f.trazado ?? []) as any,
    longitud: f.longitud,
    creadoPor: f.creadoPor ?? null,
    ...(f.creadoEn ? { creadoEn: new Date(f.creadoEn) } : {}),
  };
}

function rowToSite(r: any): Site {
  return {
    id: r.id,
    nombre: r.nombre,
    lng: r.lng,
    lat: r.lat,
    activosIds: (r.activosIds as string[]) ?? undefined,
    creadoEn: (r.creadoEn instanceof Date ? r.creadoEn.toISOString() : r.creadoEn) ?? new Date().toISOString(),
  };
}

function siteToRow(s: Site): any {
  return {
    id: s.id,
    nombre: s.nombre,
    lng: s.lng,
    lat: s.lat,
    activosIds: (s.activosIds ?? []) as any,
    ...(s.creadoEn ? { creadoEn: new Date(s.creadoEn) } : {}),
  };
}

function rowToPort(r: any): Port {
  return {
    id: r.id,
    activoId: r.activoId,
    numero: r.numero,
    rol: (r.rol as PortRole) ?? 'salida',
    estado: (r.estado as PortState) ?? 'libre',
    etiqueta: r.etiqueta ?? undefined,
    creadoEn: (r.creadoEn instanceof Date ? r.creadoEn.toISOString() : r.creadoEn) ?? new Date().toISOString(),
  };
}

function rowToConnection(r: any): Connection {
  return {
    id: r.id,
    aPuertoId: r.aPuertoId,
    bPuertoId: r.bPuertoId ?? null,
    servicioId: r.servicioId ?? null,
    hilo: r.hilo ?? null,
    segmentoFibraId: r.segmentoFibraId ?? null,
    estado: (r.estado as 'activa' | 'inactiva') ?? 'activa',
    creadoPor: r.creadoPor ?? undefined,
    creadoEn: (r.creadoEn instanceof Date ? r.creadoEn.toISOString() : r.creadoEn) ?? new Date().toISOString(),
  };
}

function readJson<T>(file: string): T[] {
  try {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Extensiones permitidas para la evidencia fotográfica, por MIME type. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

/**
 * Sanitiza una polilínea trazada en el mapa: conserva solo pares [lng,lat]
 * numéricos y finitos, y elimina vértices repetidos consecutivos (un doble clic
 * en el mismo poste no debe inflar el conteo ni romper la longitud).
 */
function sanitizePath(raw?: number[][]): number[][] {
  if (!Array.isArray(raw)) return [];
  const out: number[][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === lng && prev[1] === lat) continue;
    out.push([lng, lat]);
  }
  return out;
}

/** Longitud real (metros) de una polilínea sumando la distancia de cada tramo. */
function pathLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    total += haversine(aLat, aLng, bLat, bLng);
  }
  return total;
}
