// Economía pura del activo (Requisitos 2.2, 2.3).
import type { Economics } from './types';

/** Capital desplegado: suma de costo de compra + costo de instalación. */
export function deployedCapital(items: Array<Pick<Economics, 'costoCompra' | 'costoInstalacion'>>): number {
  return items.reduce(
    (sum, e) => sum + (e.costoCompra || 0) + (e.costoInstalacion || 0),
    0,
  );
}

/**
 * ¿La garantía está vencida respecto a `now`?
 * Vencida si hay fecha de fin de garantía y es anterior a la fecha actual.
 */
export function isWarrantyExpired(fechaFinGarantia?: string, now: Date = new Date()): boolean {
  if (!fechaFinGarantia) return false;
  const fin = new Date(fechaFinGarantia).getTime();
  if (Number.isNaN(fin)) return false;
  return fin < now.getTime();
}
