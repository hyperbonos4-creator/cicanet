// Modelo de interacción del módulo de Red.
// Un único módulo "Red" con tres MODOS que separan la intención del usuario,
// en lugar de dos apartados (Editor / Mapa) que se solapaban:
//   - design      → ingeniería: construir la topología (activos, fibra, puertos)
//   - operations  → monitoreo en vivo (solo lectura): estado, capacidad, nodos
//   - coverage    → comercial: verificar cobertura, zonas y simular expansión
export type NetworkMode = "design" | "operations" | "coverage";

export interface NetworkModeMeta {
  key: NetworkMode;
  label: string;
  hint: string;
  /** Intención de negocio del modo (para subtítulos / accesibilidad). */
  intent: string;
}

export const NETWORK_MODES: NetworkModeMeta[] = [
  { key: "design", label: "Diseño", hint: "Construir red", intent: "Ingeniería" },
  { key: "operations", label: "Operación", hint: "Estado en vivo", intent: "Operaciones" },
  { key: "coverage", label: "Cobertura", hint: "Vender y expandir", intent: "Comercial" },
];

export const NETWORK_MODE_BY_KEY: Record<NetworkMode, NetworkModeMeta> = Object.fromEntries(
  NETWORK_MODES.map((m) => [m.key, m]),
) as Record<NetworkMode, NetworkModeMeta>;

/** Capas activables del mapa de operación/cobertura. */
export type LayerKey = "barrios" | "cobertura" | "fibra" | "nodos" | "clientes";
