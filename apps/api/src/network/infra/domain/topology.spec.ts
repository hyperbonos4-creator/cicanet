import fc from 'fast-check';
import {
  ancestors,
  descendants,
  dependentClients,
  wouldCreateCycle,
  type TopoNode,
} from './topology';

/**
 * Genera un bosque (DAG en forma de árbol) sin ciclos: cada nodo i>0 toma como
 * padre algún nodo j<i (o ninguno). Devuelve los nodos y el mapa padre.
 */
const arbForest = () =>
  fc.integer({ min: 1, max: 30 }).chain((n) =>
    fc
      .tuple(
        ...Array.from({ length: n }, (_, i) =>
          i === 0
            ? fc.constant(-1)
            : fc.integer({ min: -1, max: i - 1 }), // -1 = sin padre
        ),
      )
      .map((parents) => {
        const nodes: TopoNode[] = parents.map((p, i) => ({
          id: `N${i}`,
          padreId: p === -1 ? null : `N${p}`,
          tipo: i % 3 === 0 ? 'Cliente' : 'NAP',
        }));
        return nodes;
      }),
  );

describe('topology (Requisitos 7.1–7.4, 14.1, 14.4)', () => {
  // Property 8: Cadena de dependencia ascendente — Validates: Requirements 7.2
  it('Property 8: los ancestros forman una cadena hasta la raíz vía padreId', () => {
    fc.assert(
      fc.property(arbForest(), (nodes) => {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        for (const n of nodes) {
          const chain = ancestors(nodes, n.id);
          // Cada eslabón es el padre del anterior.
          let cur: string | null | undefined = n.padreId;
          for (const a of chain) {
            expect(a).toBe(cur);
            cur = byId.get(a)?.padreId ?? null;
          }
          // El último de la cadena no tiene padre (raíz).
          if (chain.length) {
            const last = chain[chain.length - 1];
            expect(byId.get(last)?.padreId ?? null).toBeNull();
          }
        }
      }),
    );
  });

  // Property 9: Descendientes y clientes dependientes — Validates: Requirements 7.3, 14.1, 14.4
  it('Property 9: descendientes son consistentes con la relación inversa de ancestros', () => {
    fc.assert(
      fc.property(arbForest(), (nodes) => {
        for (const n of nodes) {
          const desc = new Set(descendants(nodes, n.id));
          // x es descendiente de n  <=>  n es ancestro de x.
          for (const x of nodes) {
            if (x.id === n.id) continue;
            const nEsAncestro = ancestors(nodes, x.id).includes(n.id);
            expect(desc.has(x.id)).toBe(nEsAncestro);
          }
          // dependentClients = descendientes de tipo Cliente.
          const clientes = dependentClients(nodes, n.id);
          const byId = new Map(nodes.map((m) => [m.id, m]));
          expect(new Set(clientes)).toEqual(
            new Set([...desc].filter((d) => byId.get(d)?.tipo === 'Cliente')),
          );
        }
      }),
    );
  });

  // Property 10: Rechazo de ciclos en la topología — Validates: Requirements 7.4
  it('Property 10: detecta ciclos al reasignar padre', () => {
    fc.assert(
      fc.property(arbForest(), (nodes) => {
        for (const n of nodes) {
          // Asignarse a sí mismo siempre es ciclo.
          expect(wouldCreateCycle(nodes, n.id, n.id)).toBe(true);
          // Asignar un descendiente como padre crea ciclo.
          for (const d of descendants(nodes, n.id)) {
            expect(wouldCreateCycle(nodes, n.id, d)).toBe(true);
          }
          // Asignar un ancestro como padre NO crea ciclo (ya está arriba).
          for (const a of ancestors(nodes, n.id)) {
            expect(wouldCreateCycle(nodes, n.id, a)).toBe(false);
          }
        }
      }),
    );
  });
});
