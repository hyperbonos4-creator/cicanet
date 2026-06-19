import { BadRequestException } from '@nestjs/common';
import type { EstadoServicio } from './types';

/**
 * Máquina de estados del servicio (la "línea" de internet).
 * Centraliza qué transiciones son válidas para que P1 (facturación → mora)
 * y P2 (RADIUS → corte/reconexión) reusen la misma lógica.
 *
 *   instalacion_pendiente ──► activo
 *   activo                ──► suspendido | cortado
 *   suspendido            ──► activo | cortado
 *   cortado               ──► activo
 *
 * Quedarse en el mismo estado siempre es válido (idempotente / no-op).
 */
const TRANSICIONES: Record<EstadoServicio, EstadoServicio[]> = {
  instalacion_pendiente: ['activo'],
  activo: ['suspendido', 'cortado'],
  suspendido: ['activo', 'cortado'],
  cortado: ['activo'],
};

export function puedeTransicionar(
  desde: EstadoServicio,
  hacia: EstadoServicio,
): boolean {
  if (desde === hacia) return true;
  return (TRANSICIONES[desde] || []).includes(hacia);
}

/** Lanza BadRequestException si la transición no es válida. */
export function exigirTransicionValida(
  desde: EstadoServicio,
  hacia: EstadoServicio,
): void {
  if (!puedeTransicionar(desde, hacia)) {
    const permitidas = (TRANSICIONES[desde] || []).join(', ') || '(ninguna)';
    throw new BadRequestException(
      `Transición de servicio inválida: "${desde}" → "${hacia}". ` +
        `Desde "${desde}" solo se permite: ${permitidas}.`,
    );
  }
}
