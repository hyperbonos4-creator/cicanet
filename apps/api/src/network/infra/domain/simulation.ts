// Motor de simulación del Gemelo Digital. Funciones PURAS, sin NestJS ni I/O.
//
// Responde la pregunta "¿qué pasa si...?" que vuelve al sistema un verdadero
// gemelo digital (no un dibujo): caída de un nodo o corte de fibra, propagación
// del impacto aguas abajo, clientes afectados e ingresos en riesgo.
//
// Se apoya en el grafo topológico (padreId) — la red FTTH es un árbol desde el
// POP/OLT, así que el subárbol de un nodo es exactamente lo que pierde servicio
// cuando ese nodo cae. Opcionalmente usa el grafo unificado para detectar
// redundancia (un cliente con camino alterno a la raíz no se ve afectado).

import { descendants, ancestors, type TopoNode } from './topology';
import { type NetworkGraph, shortestPath } from './network-graph';

export type FailureSeverity = 'baja' | 'media' | 'alta' | 'critica';

export interface FailureImpact {
  /** Nodo que se simula caído. */
  nodoCaido: string;
  /** Activos aguas abajo que quedan sin servicio (subárbol). */
  activosAfectados: string[];
  /** Clientes que pierden servicio. */
  clientesAfectados: string[];
  /** Ingreso mensual total en riesgo (suma de planMensual de los clientes). */
  ingresosEnRiesgo: number;
  /** Número de NAP afectadas (puntos de distribución comprometidos). */
  napsAfectadas: number;
  severidad: FailureSeverity;
}

export interface SimulationContext {
  nodes: TopoNode[];
  /** Plan mensual (COP) por id de cliente, para calcular ingresos en riesgo. */
  ingresoPorCliente?: Map<string, number>;
  /** Grafo unificado opcional para verificar caminos alternos (redundancia). */
  graph?: NetworkGraph;
  /** Ids de nodos raíz (POP/OLT) hacia los que debe existir camino. */
  raices?: string[];
}

/** Clasifica la severidad de una falla según clientes afectados. */
export function classifySeverity(clientesAfectados: number): FailureSeverity {
  if (clientesAfectados === 0) return 'baja';
  if (clientesAfectados < 10) return 'media';
  if (clientesAfectados < 50) return 'alta';
  return 'critica';
}

/**
 * Simula la caída de un nodo y calcula el impacto aguas abajo.
 * Si se entrega un grafo con redundancia, los clientes que mantienen un camino
 * alterno hacia alguna raíz NO se cuentan como afectados.
 */
export function simulateFailure(nodeId: string, ctx: SimulationContext): FailureImpact {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  const sub = descendants(ctx.nodes, nodeId);
  // El propio nodo también cae (deja de prestar servicio si es terminal).
  const afectadosBase = new Set<string>([nodeId, ...sub]);

  // Redundancia: si hay grafo + raíces, un nodo con camino alterno (sin pasar
  // por el nodo caído) NO se considera afectado.
  let activosAfectados = [...afectadosBase];
  if (ctx.graph && ctx.raices?.length) {
    activosAfectados = activosAfectados.filter(
      (id) => id === nodeId || !tieneCaminoAlterno(id, nodeId, ctx.graph!, ctx.raices!),
    );
  }

  const clientesAfectados = activosAfectados.filter((id) => byId.get(id)?.tipo === 'Cliente');
  const napsAfectadas = activosAfectados.filter((id) => {
    const t = byId.get(id)?.tipo;
    return t === 'NAP' || t === 'CTO';
  }).length;

  let ingresosEnRiesgo = 0;
  if (ctx.ingresoPorCliente) {
    for (const c of clientesAfectados) ingresosEnRiesgo += ctx.ingresoPorCliente.get(c) ?? 0;
  }

  return {
    nodoCaido: nodeId,
    activosAfectados,
    clientesAfectados,
    ingresosEnRiesgo: Math.round(ingresosEnRiesgo),
    napsAfectadas,
    severidad: classifySeverity(clientesAfectados.length),
  };
}

/** ¿`id` mantiene camino a alguna raíz sin pasar por `nodoCaido`? */
function tieneCaminoAlterno(
  id: string,
  nodoCaido: string,
  graph: NetworkGraph,
  raices: string[],
): boolean {
  // Clona el grafo quitando el nodo caído de la adyacencia.
  const pruned: NetworkGraph = {
    nodes: graph.nodes,
    edges: graph.edges.filter((e) => e.from !== nodoCaido && e.to !== nodoCaido),
    adjacency: new Map(),
  };
  for (const e of pruned.edges) {
    pushAdj(pruned.adjacency, e.from, e);
    pushAdj(pruned.adjacency, e.to, e);
  }
  return raices.some((r) => r !== nodoCaido && shortestPath(pruned, id, r).encontrado);
}

function pushAdj(adj: Map<string, any[]>, key: string, e: any) {
  const arr = adj.get(key) || [];
  arr.push(e);
  adj.set(key, arr);
}

export interface NodeRanking {
  id: string;
  tipo?: string;
  clientesAfectados: number;
  ingresosEnRiesgo: number;
  severidad: FailureSeverity;
}

/**
 * Ranking de nodos por criticidad: cuáles, si fallan, dejan más clientes sin
 * servicio. Útil para priorizar mantenimiento, redundancia y monitoreo (SPOF).
 */
export function criticalityRanking(ctx: SimulationContext, limit = 10): NodeRanking[] {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  const ranking: NodeRanking[] = [];
  for (const n of ctx.nodes) {
    // Solo nodos de transporte/distribución son candidatos a SPOF relevante.
    if (n.tipo === 'Cliente' || n.tipo === 'ONU') continue;
    const impact = simulateFailure(n.id, ctx);
    if (impact.clientesAfectados.length === 0) continue;
    ranking.push({
      id: n.id,
      tipo: byId.get(n.id)?.tipo,
      clientesAfectados: impact.clientesAfectados.length,
      ingresosEnRiesgo: impact.ingresosEnRiesgo,
      severidad: impact.severidad,
    });
  }
  ranking.sort(
    (a, b) => b.clientesAfectados - a.clientesAfectados || b.ingresosEnRiesgo - a.ingresosEnRiesgo,
  );
  return ranking.slice(0, limit);
}

/** Cadena de dependencia de un activo hacia la raíz (para mostrar "de qué depende"). */
export function dependencyChain(nodeId: string, nodes: TopoNode[]): string[] {
  return [nodeId, ...ancestors(nodes, nodeId)];
}
