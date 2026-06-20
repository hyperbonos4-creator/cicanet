import { ConflictException } from '@nestjs/common';

/**
 * Máquinas de estado documental (Fase A2). Centraliza las transiciones válidas
 * de cada documento financiero para que ningún módulo "salte" estados a mano.
 * Es un registro declarativo + un guardia (`assertTransicion`) reutilizable.
 */
export type DocKind = 'factura_venta' | 'factura_compra' | 'extracto' | 'comprobante' | 'recibo_caja' | 'acuerdo_pago';

type TransitionMap = Record<string, string[]>;

const MAQUINAS: Record<DocKind, TransitionMap> = {
  // Factura de venta interna (recurrente / electrónica).
  factura_venta: {
    borrador: ['emitida', 'anulada'],
    emitida: ['electronica', 'pagada', 'parcial', 'vencida', 'anulada'],
    electronica: ['pagada', 'parcial', 'vencida', 'anulada'],
    parcial: ['pagada', 'vencida', 'anulada'],
    vencida: ['pagada', 'parcial', 'castigada', 'anulada'],
    pagada: ['reversada'],
    castigada: ['reversada'],
    anulada: [],
    reversada: [],
    // estados legados equivalentes usados hoy en el dominio:
    pendiente: ['pagada', 'parcial', 'vencida', 'anulada', 'castigada'],
  },
  // Factura de compra / causación.
  factura_compra: {
    borrador: ['pendiente', 'anulada'],
    pendiente: ['pagada', 'anulada'],
    pagada: ['reversada'],
    anulada: [],
    reversada: [],
  },
  // Extracto / movimiento bancario.
  extracto: {
    sin_conciliar: ['conciliado', 'ignorado'],
    conciliado: ['sin_conciliar'], // permite des-conciliar (reversa)
    ignorado: ['sin_conciliar'],
  },
  // Comprobante contable (asiento).
  comprobante: {
    borrador: ['contabilizado', 'anulado'],
    contabilizado: ['anulado'], // anulado vía reversión
    anulado: [],
  },
  // Recibo de caja (cash application).
  recibo_caja: {
    sin_aplicar: ['parcial', 'aplicado', 'anulado'],
    parcial: ['aplicado', 'anulado'],
    aplicado: ['anulado'],
    anulado: [],
  },
  // Acuerdo de pago / refinanciación.
  acuerdo_pago: {
    vigente: ['cumplido', 'incumplido', 'cancelado'],
    cumplido: [],
    incumplido: ['vigente', 'cancelado'],
    cancelado: [],
  },
};

/** Devuelve las transiciones válidas declaradas (para exponerlas en la UI). */
export function maquinasDeEstado() {
  return MAQUINAS;
}

/** ¿Es válida la transición desde→hacia en este tipo de documento? */
export function puedeTransicionar(kind: DocKind, desde: string, hacia: string): boolean {
  if (desde === hacia) return true;
  return (MAQUINAS[kind]?.[desde] ?? []).includes(hacia);
}

/** Lanza ConflictException si la transición no es válida. Úsese antes de persistir. */
export function assertTransicion(kind: DocKind, desde: string, hacia: string): void {
  if (!puedeTransicionar(kind, desde, hacia)) {
    throw new ConflictException(
      `Transición inválida en ${kind}: "${desde}" → "${hacia}". Permitidas: ${(MAQUINAS[kind]?.[desde] ?? []).join(', ') || '(ninguna)'}.`,
    );
  }
}
