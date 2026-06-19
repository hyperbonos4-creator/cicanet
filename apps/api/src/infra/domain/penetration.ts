// Hogares potenciales y penetración por sector (Requisitos 12.2–12.4).

export interface SectorClient {
  /** ¿El cliente está activo? Solo los activos cuentan como hogar conectado. */
  activo: boolean;
}

/** Hogares conectados = clientes activos asociados al sector. */
export function connectedHomes(clients: SectorClient[]): number {
  return clients.reduce((n, c) => n + (c.activo ? 1 : 0), 0);
}

/**
 * Penetración = % de hogares conectados sobre estimados.
 * Devuelve `null` (no disponible) cuando los hogares estimados son 0.
 */
export function penetration(hogaresEstimados: number, hogaresConectados: number): number | null {
  if (!hogaresEstimados || hogaresEstimados <= 0) return null;
  return (hogaresConectados / hogaresEstimados) * 100;
}
