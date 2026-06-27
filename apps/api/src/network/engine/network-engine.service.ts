import { Injectable, NotFoundException } from '@nestjs/common';
import { InfraService } from '../infra/infra.service';
import type { Asset } from '../infra/domain/types';
import { ancestors, type TopoNode } from '../infra/domain/topology';
import {
  buildGraph,
  topologyEdges,
  fiberEdges,
  shortestPath,
  connectedComponents,
  type NetworkGraph,
} from '../infra/domain/network-graph';
import {
  simulateFailure,
  criticalityRanking,
  dependencyChain,
  type SimulationContext,
} from '../infra/domain/simulation';
import {
  linkBudget,
  type OpticalElement,
  type SplitRatio,
  type Wavelength,
  SPLIT_RATIOS,
} from '../infra/domain/optical';

/** Distancia en metros entre dos coordenadas (haversine). */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Mapea un conteo de puertos al ratio de splitter estándar más cercano. */
function nearestSplitRatio(puertos?: number): SplitRatio {
  if (!puertos || puertos < 2) return 8;
  let best: SplitRatio = SPLIT_RATIOS[0];
  let bestDiff = Infinity;
  for (const r of SPLIT_RATIOS) {
    const diff = Math.abs(r - puertos);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

/**
 * Motor de Red (Network Engine): el "cerebro" del Gemelo Digital.
 *
 * Desacoplado de la capa GIS y del plumbing de datos: consume una instantánea
 * de InfraService y construye un GRAFO UNIFICADO (topología + fibra) sobre el
 * que corre algoritmos de grado industrial:
 *   - presupuesto óptico real (dB OLT→cliente) — ingeniería FTTH/GPON
 *   - simulación de fallas e impacto (clientes/ingresos en riesgo)
 *   - ranking de criticidad (SPOF) para priorizar redundancia
 *   - camino más corto entre dos activos (Dijkstra ponderado por fibra)
 */
@Injectable()
export class NetworkEngineService {
  constructor(private readonly infra: InfraService) {}

  // ---- construcción del modelo (desde la instantánea) ----

  private topoNodes(assets: Asset[]): TopoNode[] {
    return assets.map((a) => ({ id: a.id, padreId: a.padreId ?? null, tipo: a.tipo }));
  }

  private ingresoPorCliente(assets: Asset[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const a of assets) {
      if (a.tipo === 'Cliente') m.set(a.id, Number(a.planMensual) || 0);
    }
    return m;
  }

  private buildUnifiedGraph(assets: Asset[]): NetworkGraph {
    const fiber = this.infra.snapshot().fiber;
    const nodes = assets.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      lng: a.lng,
      lat: a.lat,
      estado: a.estado,
    }));
    const edges = [...topologyEdges(this.topoNodes(assets)), ...fiberEdges(fiber)];
    return buildGraph(nodes, edges);
  }

  private context(assets: Asset[], withGraph = false): SimulationContext {
    const ctx: SimulationContext = {
      nodes: this.topoNodes(assets),
      ingresoPorCliente: this.ingresoPorCliente(assets),
    };
    if (withGraph) {
      ctx.graph = this.buildUnifiedGraph(assets);
      ctx.raices = assets.filter((a) => a.tipo === 'POP' || a.tipo === 'OLT').map((a) => a.id);
    }
    return ctx;
  }

  // ---- API del motor ----

  /** Resumen del modelo de red: nodos, aristas, islas (componentes conexas). */
  overview() {
    const { assets, fiber } = this.infra.snapshot();
    const graph = this.buildUnifiedGraph(assets);
    const islas = connectedComponents(graph);
    return {
      nodos: assets.length,
      fibras: fiber.length,
      aristas: graph.edges.length,
      islas: islas.length,
      // Detecta islas sin POP/OLT (planta huérfana, sin transporte hacia el core).
      islasSinRaiz: islas.filter(
        (comp) => !comp.some((id) => {
          const a = assets.find((x) => x.id === id);
          return a?.tipo === 'POP' || a?.tipo === 'OLT';
        }),
      ).length,
    };
  }

  /** Simula la caída de un activo: impacto aguas abajo, clientes e ingresos en riesgo. */
  simulateFailure(id: string) {
    const { assets } = this.infra.snapshot();
    if (!assets.some((a) => a.id === id)) throw new NotFoundException('Activo no encontrado.');
    return simulateFailure(id, this.context(assets, true));
  }

  /** Ranking de criticidad (SPOF): qué activos, si fallan, dejan más clientes sin servicio. */
  criticality(limit = 10) {
    const { assets } = this.infra.snapshot();
    const byId = new Map(assets.map((a) => [a.id, a]));
    return criticalityRanking(this.context(assets), limit).map((r) => ({
      ...r,
      nombre: byId.get(r.id)?.nombre ?? r.id,
    }));
  }

  /** Camino más corto (ponderado por longitud de fibra) entre dos activos. */
  path(from: string, to: string) {
    const { assets } = this.infra.snapshot();
    const graph = this.buildUnifiedGraph(assets);
    const byId = new Map(assets.map((a) => [a.id, a]));
    const r = shortestPath(graph, from, to);
    return {
      ...r,
      nodos: r.path.map((id) => ({
        id,
        nombre: byId.get(id)?.nombre ?? id,
        tipo: byId.get(id)?.tipo,
      })),
    };
  }

  /**
   * Presupuesto óptico de un activo: recorre la cadena del activo hacia su raíz
   * (POP/OLT) acumulando pérdidas reales de fibra, splitters, empalmes y
   * conectores, y devuelve el margen disponible (dB) — la validación de
   * ingeniería que dice si el cliente recibe señal con reserva.
   */
  opticalBudget(
    id: string,
    opts?: { txPowerDbm?: number; rxSensitivityDbm?: number; wavelength?: Wavelength },
  ) {
    const { assets, fiber } = this.infra.snapshot();
    const byId = new Map(assets.map((a) => [a.id, a]));
    const start = byId.get(id);
    if (!start) throw new NotFoundException('Activo no encontrado.');

    // Cadena del activo a la raíz: [activo, padre, ..., raíz].
    const chain = [id, ...ancestors(this.topoNodes(assets), id)];
    const elementos: OpticalElement[] = [];

    // Índice de fibras por par de extremos (en cualquier dirección).
    const fiberByPair = new Map<string, { longitud: number; modo?: string }>();
    for (const f of fiber) {
      if (f.origenId && f.destinoId) {
        fiberByPair.set(`${f.origenId}|${f.destinoId}`, {
          longitud: f.longitud,
          modo: f.tipoFibra,
        });
        fiberByPair.set(`${f.destinoId}|${f.origenId}`, {
          longitud: f.longitud,
          modo: f.tipoFibra,
        });
      }
    }

    // Recorre pares (inferior, superior) de la cadena hacia la raíz.
    for (let i = 0; i < chain.length - 1; i++) {
      const lower = byId.get(chain[i]);
      const upper = byId.get(chain[i + 1]);
      if (!lower || !upper) continue;

      // Tramo de fibra: usa la longitud real registrada; si no, estima por
      // distancia geográfica entre los dos activos.
      const seg = fiberByPair.get(`${lower.id}|${upper.id}`);
      const longitudM = seg
        ? seg.longitud
        : Math.round(haversine(lower.lat, lower.lng, upper.lat, upper.lng));
      elementos.push({
        tipo: 'fibra',
        etiqueta: `${lower.nombre} → ${upper.nombre}`,
        longitudM,
        modo: seg?.modo === 'multimodo' ? 'multimodo' : 'monomodo',
      });
      // Cada empalme entre activos suma un conector.
      elementos.push({ tipo: 'conector', cantidad: 1, etiqueta: `Conexión en ${upper.nombre}` });

      // Si el nodo superior es un splitter, aporta su pérdida de inserción.
      if (upper.tipo === 'Splitter') {
        const puertos = Number(upper.atributos?.puertosTotal ?? upper.atributos?.salidas);
        const ratio = nearestSplitRatio(puertos);
        elementos.push({ tipo: 'splitter', ratio, etiqueta: `${upper.nombre} (1:${ratio})` });
      }
    }

    const result = linkBudget({
      txPowerDbm: opts?.txPowerDbm,
      rxSensitivityDbm: opts?.rxSensitivityDbm,
      wavelength: opts?.wavelength,
      elementos,
    });

    return {
      activo: { id: start.id, nombre: start.nombre, tipo: start.tipo },
      cadena: chain.map((cid) => ({
        id: cid,
        nombre: byId.get(cid)?.nombre ?? cid,
        tipo: byId.get(cid)?.tipo,
      })),
      ...result,
    };
  }

  /** Cadena de dependencia de un activo hacia la raíz (de qué depende). */
  dependencies(id: string) {
    const { assets } = this.infra.snapshot();
    const byId = new Map(assets.map((a) => [a.id, a]));
    if (!byId.has(id)) throw new NotFoundException('Activo no encontrado.');
    return dependencyChain(id, this.topoNodes(assets)).map((cid) => ({
      id: cid,
      nombre: byId.get(cid)?.nombre ?? cid,
      tipo: byId.get(cid)?.tipo,
    }));
  }
}
