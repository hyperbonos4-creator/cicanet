// Motor de grafo unificado del Gemelo Digital. Funciones PURAS, sin NestJS ni I/O.
//
// Hoy la red vive en tres grafos separados: topología (padreId), conexiones de
// puertos y segmentos de fibra. Este módulo los UNIFICA en un solo grafo
// consultable, sobre el que se pueden correr algoritmos clásicos (camino más
// corto, propagación de fallas, componentes conexas) — el corazón "Net2Plan
// style" que faltaba.

export type EdgeKind = 'topologia' | 'fibra' | 'puerto';

export interface GraphNodeInput {
  id: string;
  tipo: string;
  lng?: number;
  lat?: number;
  /** Estado operativo (Activo/Inactivo/Dañado…). Se usa para simular fallas. */
  estado?: string;
}

export interface GraphEdgeInput {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** Peso del enlace (metros de fibra por defecto). Para Dijkstra. */
  pesoM?: number;
}

export interface GraphNode extends GraphNodeInput {}

export interface GraphEdge extends GraphEdgeInput {
  /** Peso efectivo usado por los algoritmos (siempre ≥ 0). */
  peso: number;
}

export interface NetworkGraph {
  nodes: Map<string, GraphNode>;
  /** Lista de adyacencia NO dirigida: nodeId -> aristas incidentes. */
  adjacency: Map<string, GraphEdge[]>;
  edges: GraphEdge[];
}

/** Construye el grafo unificado a partir de nodos y aristas heterogéneas. */
export function buildGraph(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): NetworkGraph {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, { ...n });

  const adjacency = new Map<string, GraphEdge[]>();
  const all: GraphEdge[] = [];
  for (const e of edges) {
    // Ignora aristas colgantes (extremos inexistentes) para mantener integridad.
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
    const edge: GraphEdge = { ...e, peso: Math.max(0, e.pesoM ?? 1) };
    all.push(edge);
    pushAdj(adjacency, e.from, edge);
    pushAdj(adjacency, e.to, edge);
  }
  return { nodes: nodeMap, adjacency, edges: all };
}

function pushAdj(adj: Map<string, GraphEdge[]>, id: string, e: GraphEdge) {
  const arr = adj.get(id) || [];
  arr.push(e);
  adj.set(id, arr);
}

/** Construye aristas de topología (cada activo → su padre). */
export function topologyEdges(nodes: { id: string; padreId?: string | null }[]): GraphEdgeInput[] {
  const out: GraphEdgeInput[] = [];
  for (const n of nodes) {
    if (n.padreId) {
      out.push({ id: `topo:${n.id}`, from: n.id, to: n.padreId, kind: 'topologia' });
    }
  }
  return out;
}

/** Construye aristas de fibra (origen↔destino) ponderadas por longitud. */
export function fiberEdges(
  fibers: { id: string; origenId?: string | null; destinoId?: string | null; longitud?: number }[],
): GraphEdgeInput[] {
  const out: GraphEdgeInput[] = [];
  for (const f of fibers) {
    if (f.origenId && f.destinoId) {
      out.push({
        id: `fibra:${f.id}`,
        from: f.origenId,
        to: f.destinoId,
        kind: 'fibra',
        pesoM: f.longitud,
      });
    }
  }
  return out;
}

/** Vecinos directos de un nodo. */
export function neighbors(graph: NetworkGraph, id: string): string[] {
  const seen = new Set<string>();
  for (const e of graph.adjacency.get(id) || []) {
    seen.add(e.from === id ? e.to : e.from);
  }
  return [...seen];
}

export interface PathResult {
  /** Ids de nodos del camino (origen → destino). Vacío si no hay camino. */
  path: string[];
  /** Aristas usadas en orden. */
  edges: GraphEdge[];
  /** Distancia total acumulada (suma de pesos). */
  distancia: number;
  encontrado: boolean;
}

/**
 * Camino más corto entre dos nodos (Dijkstra) sobre el grafo unificado.
 * El peso por defecto es la longitud de fibra; las aristas de topología/puerto
 * pesan 1 salvo que se indique. Determinista ante empates (menor id).
 */
export function shortestPath(graph: NetworkGraph, from: string, to: string): PathResult {
  const empty: PathResult = { path: [], edges: [], distancia: Infinity, encontrado: false };
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return empty;
  if (from === to) return { path: [from], edges: [], distancia: 0, encontrado: true };

  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const visited = new Set<string>();
  dist.set(from, 0);

  // Cola simple O(V²): suficiente para redes de planta de un ISP regional.
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [node, d] of dist) {
      if (visited.has(node)) continue;
      if (d < best || (d === best && (u === null || node < u))) {
        best = d;
        u = node;
      }
    }
    if (u === null) break;
    if (u === to) break;
    visited.add(u);

    for (const e of graph.adjacency.get(u) || []) {
      const v = e.from === u ? e.to : e.from;
      if (visited.has(v)) continue;
      const alt = best + e.peso;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, { node: u, edge: e });
      }
    }
  }

  if (!dist.has(to)) return empty;

  const path: string[] = [];
  const edges: GraphEdge[] = [];
  let cur = to;
  while (cur !== from) {
    path.unshift(cur);
    const p = prev.get(cur);
    if (!p) return empty; // sin camino
    edges.unshift(p.edge);
    cur = p.node;
  }
  path.unshift(from);
  return { path, edges, distancia: round2(dist.get(to)!), encontrado: true };
}

/** Componentes conexas del grafo (islas de red sin enlace entre sí). */
export function connectedComponents(graph: NetworkGraph): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of graph.nodes.keys()) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of neighbors(graph, u)) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    out.push(comp.sort());
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
