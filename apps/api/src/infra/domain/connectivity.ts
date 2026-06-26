// Conectividad pura del Gemelo Digital (Fase puerto).
// Opera sobre puertos y conexiones (grafo de aristas) sin depender de NestJS ni
// I/O. Habilita la ocupación REAL por puertos y el trazado óptico OLT→cliente.
//
// Modelo: un Puerto pertenece a un Activo. Una Conexion enlaza un puerto de
// origen (aPuertoId) con otro puerto (bPuertoId) o con un servicio terminal
// (servicioId). El trazado combina la cadena topológica (ancestros por padreId)
// con el puerto concreto usado en cada salto.

export type PortState = 'libre' | 'ocupado' | 'reservado' | 'dañado';

export interface PortLike {
  id: string;
  activoId: string;
  numero: number;
  rol?: string;
  estado: string;
}

export interface ConnLike {
  id: string;
  aPuertoId: string;
  bPuertoId?: string | null;
  servicioId?: string | null;
  hilo?: number | null;
  segmentoFibraId?: string | null;
  estado?: string;
}

export class ConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectivityError';
  }
}

export interface PortStats {
  total: number;
  ocupados: number;
  libres: number;
  reservados: number;
  danados: number;
}

/** Resumen de ocupación de un conjunto de puertos (capacidad REAL derivada). */
export function portStats(ports: PortLike[]): PortStats {
  let ocupados = 0;
  let libres = 0;
  let reservados = 0;
  let danados = 0;
  for (const p of ports) {
    switch (p.estado) {
      case 'ocupado':
        ocupados++;
        break;
      case 'reservado':
        reservados++;
        break;
      case 'dañado':
        danados++;
        break;
      default:
        libres++;
    }
  }
  return { total: ports.length, ocupados, libres, reservados, danados };
}

/**
 * Semáforo de capacidad a partir de puertos reales (mismos umbrales que
 * `capacity.semaphore`): rojo si no hay puertos vendibles (libres = 0),
 * amarillo si la ocupación ≥ 75% del total, verde en caso contrario.
 * Solo cuentan como "vendibles" los puertos libres; los dañados/reservados
 * reducen la capacidad efectiva pero no se consideran ocupados por cliente.
 */
export function portSemaphore(stats: PortStats): 'verde' | 'amarillo' | 'rojo' {
  if (stats.total === 0) return 'rojo';
  if (stats.libres === 0) return 'rojo';
  const usados = stats.total - stats.libres; // ocupados + reservados + dañados
  return usados / stats.total >= 0.75 ? 'amarillo' : 'verde';
}

/**
 * ¿Puede ocuparse este puerto por un cliente nuevo?
 * Solo los puertos en estado 'libre' son asignables.
 */
export function isAssignable(port: PortLike): boolean {
  return port.estado === 'libre';
}

export interface TraceHop {
  /** Id del activo en este salto del camino óptico. */
  activoId: string;
  /** Puerto usado en este activo (si se conoce la conexión). */
  puertoNumero?: number;
  puertoId?: string;
  /** Hilo de fibra y segmento que transporta el salto (si se documentó). */
  hilo?: number | null;
  segmentoFibraId?: string | null;
}

/**
 * Trazado óptico desde un activo hacia la raíz (POP/OLT), siguiendo la cadena de
 * ancestros topológicos y anotando, en cada salto, el puerto y el hilo usados si
 * existe una conexión que enlace puertos de dos activos consecutivos de la cadena.
 *
 * @param chain  Ids de activos del extremo a la raíz: [activo, padre, ..., raíz].
 * @param portsByAsset  Puertos indexados por activoId.
 * @param connections  Todas las conexiones conocidas.
 */
export function tracePath(
  chain: string[],
  portsByAsset: Map<string, PortLike[]>,
  connections: ConnLike[],
): TraceHop[] {
  if (chain.length === 0) return [];

  // Índice puertoId -> activoId para resolver a qué activo pertenece un puerto.
  const assetByPort = new Map<string, string>();
  for (const [assetId, ports] of portsByAsset) {
    for (const p of ports) assetByPort.set(p.id, assetId);
  }
  const portById = new Map<string, PortLike>();
  for (const ports of portsByAsset.values()) {
    for (const p of ports) portById.set(p.id, p);
  }

  const inChain = new Set(chain);
  const hops: TraceHop[] = chain.map((activoId) => ({ activoId }));
  const hopIndex = new Map(chain.map((id, i) => [id, i]));

  // Para cada conexión puerto↔puerto cuyos extremos caen en dos activos de la
  // cadena, anotamos el puerto en el activo correspondiente del trazado.
  for (const c of connections) {
    if (c.estado && c.estado !== 'activa') continue;
    const aAsset = assetByPort.get(c.aPuertoId);
    const bAsset = c.bPuertoId ? assetByPort.get(c.bPuertoId) : undefined;
    if (aAsset && inChain.has(aAsset)) {
      const p = portById.get(c.aPuertoId);
      const i = hopIndex.get(aAsset)!;
      if (p && hops[i].puertoNumero == null) {
        hops[i].puertoNumero = p.numero;
        hops[i].puertoId = p.id;
        hops[i].hilo = c.hilo ?? undefined;
        hops[i].segmentoFibraId = c.segmentoFibraId ?? undefined;
      }
    }
    if (bAsset && inChain.has(bAsset)) {
      const p = c.bPuertoId ? portById.get(c.bPuertoId) : undefined;
      const i = hopIndex.get(bAsset)!;
      if (p && hops[i].puertoNumero == null) {
        hops[i].puertoNumero = p.numero;
        hops[i].puertoId = p.id;
      }
    }
  }

  return hops;
}
