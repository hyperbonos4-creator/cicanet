// Gestión de capacidad pura (Requisitos 9.1–9.5).
import type { CapacitySemaphore } from './types';

export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapacityError';
  }
}

/** Puertos libres = total − usados (nunca negativo). */
export function freePorts(total: number, usados: number): number {
  return Math.max(0, total - usados);
}

/** ¿Es válida la combinación total/usados? (usados ≤ total y ambos ≥ 0). */
export function isValidCapacity(total: number, usados: number): boolean {
  return (
    Number.isFinite(total) &&
    Number.isFinite(usados) &&
    total >= 0 &&
    usados >= 0 &&
    usados <= total
  );
}

/**
 * Semáforo de capacidad (R9.2–R9.4):
 *  - verde:    usados < 75% del total
 *  - amarillo: 75% ≤ usados < 100%
 *  - rojo:     usados = total (100%)
 * Con total = 0 (sin puertos), se considera rojo (no hay capacidad para vender).
 */
export function semaphore(total: number, usados: number): CapacitySemaphore {
  if (!isValidCapacity(total, usados)) {
    throw new CapacityError('Capacidad inválida: los puertos usados no pueden superar el total.');
  }
  if (total === 0) return 'rojo';
  if (usados >= total) return 'rojo';
  const ratio = usados / total;
  if (ratio < 0.75) return 'verde';
  return 'amarillo';
}

/** Valida y devuelve los puertos usados; lanza si usados > total. */
export function assertValidUsedPorts(total: number, usados: number): number {
  if (!isValidCapacity(total, usados)) {
    throw new CapacityError(
      `Capacidad inválida: puertos usados (${usados}) no pueden superar el total (${total}).`,
    );
  }
  return usados;
}
