import {
  buildGraph,
  topologyEdges,
  fiberEdges,
  neighbors,
  shortestPath,
  connectedComponents,
  type GraphNodeInput,
} from './network-graph';

const nodes: GraphNodeInput[] = [
  { id: 'POP-1', tipo: 'POP' },
  { id: 'OLT-1', tipo: 'OLT' },
  { id: 'NAP-1', tipo: 'NAP' },
  { id: 'NAP-2', tipo: 'NAP' },
  { id: 'CLI-1', tipo: 'Cliente' },
];

describe('network-graph (motor de grafo unificado)', () => {
  it('construye aristas de topología desde padreId', () => {
    const edges = topologyEdges([
      { id: 'OLT-1', padreId: 'POP-1' },
      { id: 'NAP-1', padreId: 'OLT-1' },
      { id: 'POP-1', padreId: null },
    ]);
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.from === 'NAP-1')?.to).toBe('OLT-1');
  });

  it('construye aristas de fibra ponderadas por longitud', () => {
    const edges = fiberEdges([
      { id: 'FIB-1', origenId: 'OLT-1', destinoId: 'NAP-1', longitud: 1200 },
      { id: 'FIB-2', origenId: 'OLT-1', destinoId: null, longitud: 500 }, // descartada
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].pesoM).toBe(1200);
  });

  it('ignora aristas con extremos inexistentes', () => {
    const g = buildGraph(nodes, [
      { id: 'e1', from: 'POP-1', to: 'OLT-1', kind: 'topologia' },
      { id: 'eX', from: 'POP-1', to: 'FANTASMA', kind: 'fibra' },
    ]);
    expect(g.edges).toHaveLength(1);
  });

  it('calcula vecinos en grafo no dirigido', () => {
    const g = buildGraph(nodes, [
      { id: 'e1', from: 'POP-1', to: 'OLT-1', kind: 'topologia' },
      { id: 'e2', from: 'OLT-1', to: 'NAP-1', kind: 'topologia' },
    ]);
    expect(neighbors(g, 'OLT-1').sort()).toEqual(['NAP-1', 'POP-1']);
  });

  describe('shortestPath (Dijkstra)', () => {
    const g = buildGraph(nodes, [
      { id: 'f1', from: 'POP-1', to: 'OLT-1', kind: 'fibra', pesoM: 100 },
      { id: 'f2', from: 'OLT-1', to: 'NAP-1', kind: 'fibra', pesoM: 200 },
      { id: 'f3', from: 'OLT-1', to: 'NAP-2', kind: 'fibra', pesoM: 50 },
      { id: 'f4', from: 'NAP-2', to: 'NAP-1', kind: 'fibra', pesoM: 30 },
      { id: 'f5', from: 'NAP-1', to: 'CLI-1', kind: 'topologia', pesoM: 1 },
    ]);

    it('elige el camino de menor peso (vía NAP-2), no el directo', () => {
      const r = shortestPath(g, 'OLT-1', 'NAP-1');
      // directo OLT→NAP-1 = 200; vía NAP-2 = 50 + 30 = 80
      expect(r.encontrado).toBe(true);
      expect(r.distancia).toBe(80);
      expect(r.path).toEqual(['OLT-1', 'NAP-2', 'NAP-1']);
    });

    it('encuentra el camino completo POP → Cliente', () => {
      const r = shortestPath(g, 'POP-1', 'CLI-1');
      expect(r.encontrado).toBe(true);
      expect(r.path[0]).toBe('POP-1');
      expect(r.path[r.path.length - 1]).toBe('CLI-1');
    });

    it('devuelve distancia 0 para origen=destino', () => {
      expect(shortestPath(g, 'OLT-1', 'OLT-1').distancia).toBe(0);
    });

    it('reporta no encontrado si no hay conexión', () => {
      const g2 = buildGraph(nodes, [{ id: 'f1', from: 'POP-1', to: 'OLT-1', kind: 'fibra' }]);
      expect(shortestPath(g2, 'POP-1', 'CLI-1').encontrado).toBe(false);
    });
  });

  it('detecta componentes conexas (islas de red)', () => {
    const g = buildGraph(nodes, [
      { id: 'e1', from: 'POP-1', to: 'OLT-1', kind: 'topologia' },
      { id: 'e2', from: 'NAP-1', to: 'CLI-1', kind: 'topologia' },
    ]);
    const comps = connectedComponents(g);
    // {POP-1,OLT-1}, {NAP-1,CLI-1}, {NAP-2}
    expect(comps).toHaveLength(3);
    expect(comps.map((c) => c.length).sort()).toEqual([1, 2, 2]);
  });
});
