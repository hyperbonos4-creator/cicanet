// Topología pura del Gemelo Digital (Requisitos 7.1–7.4, 14.1, 14.4).
// Opera sobre un grafo de nodos { id, padreId } sin depender de NestJS ni I/O.

export interface TopoNode {
  id: string;
  padreId?: string | null;
  tipo?: string;
}

/** Índice id -> hijos directos. */
function childrenIndex(nodes: TopoNode[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.padreId) {
      const arr = idx.get(n.padreId) || [];
      arr.push(n.id);
      idx.set(n.padreId, arr);
    }
  }
  return idx;
}

/**
 * Cadena ascendente de dependencia: del activo hacia la raíz (POP).
 * Devuelve los ids de los ancestros en orden (padre, abuelo, …, raíz).
 * Es tolerante a ciclos preexistentes (corta al detectar repetición).
 */
export function ancestors(nodes: TopoNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.padreId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = byId.get(cur)?.padreId ?? null;
  }
  return out;
}

/**
 * Todos los descendientes (subárbol) de un activo, en ningún orden particular.
 * Tolerante a ciclos.
 */
export function descendants(nodes: TopoNode[], id: string): string[] {
  const idx = childrenIndex(nodes);
  const out = new Set<string>();
  const stack = [...(idx.get(id) || [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    for (const g of idx.get(c) || []) stack.push(g);
  }
  return [...out];
}

/** Clientes (tipo === 'Cliente') que dependen de un activo. */
export function dependentClients(nodes: TopoNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return descendants(nodes, id).filter((d) => byId.get(d)?.tipo === 'Cliente');
}

/**
 * ¿Asignar `parentId` como padre de `id` crearía un ciclo?
 * Crea ciclo si parentId === id, o si parentId ya es descendiente de id.
 */
export function wouldCreateCycle(
  nodes: TopoNode[],
  id: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  return descendants(nodes, id).includes(parentId);
}
