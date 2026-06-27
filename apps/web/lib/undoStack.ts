// Historial de DESHACER para el diseño de la red. Es un stack de acciones
// reversibles: cada tarea que el operador realiza (colocar un activo, trazar un
// tramo, encadenar postes…) registra aquí su ACCIÓN INVERSA. Así se puede
// deshacer tarea por tarea —o saltar varias de golpe— sin volver a empezar.
//
// Es un store singleton con suscripción (patrón observable), para que cualquier
// componente lo use sin pasar props por todo el árbol.

export type UndoEntry = {
  id: string;
  label: string;
  at: number;
  /** Acción inversa: deshace la tarea (y refresca lo que haga falta). */
  run: () => Promise<void>;
};

const MAX = 100;
let stack: UndoEntry[] = [];
let busy = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const undoStack = {
  /** Registra una tarea con su acción inversa. */
  push(label: string, run: () => Promise<void>) {
    stack.push({ id: newId(), label, at: Date.now(), run });
    if (stack.length > MAX) stack.shift();
    emit();
  },

  /** Deshace la última tarea. Devuelve su etiqueta (o null si no hay nada). */
  async undo(): Promise<string | null> {
    if (busy) return null;
    const e = stack.pop();
    if (!e) {
      emit();
      return null;
    }
    busy = true;
    emit();
    try {
      await e.run();
      return e.label;
    } catch (err) {
      // Si la acción inversa falla, la reponemos para no perder el historial.
      stack.push(e);
      throw err;
    } finally {
      busy = false;
      emit();
    }
  },

  /** Deshace TODAS las tareas hasta (incluyendo) la del id indicado. */
  async undoTo(id: string): Promise<void> {
    if (busy) return;
    const idx = stack.findIndex((e) => e.id === id);
    if (idx < 0) return;
    // Deshace desde la cima hasta el objetivo, en orden inverso (LIFO).
    while (stack.length > idx) {
      const e = stack.pop()!;
      busy = true;
      emit();
      try {
        await e.run();
      } catch (err) {
        stack.push(e);
        busy = false;
        emit();
        throw err;
      }
    }
    busy = false;
    emit();
  },

  /** Vacía el historial (p. ej. al cambiar de contexto). */
  clear() {
    stack = [];
    emit();
  },

  /** Tareas más recientes primero. */
  list(): UndoEntry[] {
    return [...stack].reverse();
  },

  size(): number {
    return stack.length;
  },

  isBusy(): boolean {
    return busy;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
