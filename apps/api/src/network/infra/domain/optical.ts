// Presupuesto óptico (optical link budget) GPON/FTTH. Funciones PURAS, sin I/O.
//
// Este módulo convierte una cadena óptica (OLT → fibra → splitters → cliente) en
// un cálculo real de pérdida en dB y margen disponible, que es exactamente lo
// que valida si un cliente puede recibir señal. Es la pieza "nivel ingeniería"
// que faltaba: hoy el trazado muestra saltos pero no presupuesto óptico.
//
// Valores por defecto según referencias de industria (FOA, Cisco, ITU-T G.984):
//  - Monomodo: ~0.35 dB/km @1310nm, ~0.25 dB/km @1550nm
//  - Empalme por fusión: ~0.1 dB; conector: ~0.5 dB
//  - Splitter: pérdida de inserción según ratio de división
//  - Clases GPON: B+ = 28 dB, C+ = 32 dB de presupuesto
// Las pérdidas son aproximaciones de planificación; el diseño real debe dejar
// un margen de seguridad (envejecimiento, conectores sucios, reparaciones).

export type Wavelength = 1310 | 1490 | 1550;
export const WAVELENGTHS: Wavelength[] = [1310, 1490, 1550];

export type SplitRatio = 2 | 4 | 8 | 16 | 32 | 64 | 128;
export const SPLIT_RATIOS: SplitRatio[] = [2, 4, 8, 16, 32, 64, 128];

/** Atenuación de fibra (dB/km) por modo y longitud de onda. */
export const FIBER_ATTENUATION_DB_KM: Record<'monomodo' | 'multimodo', Record<Wavelength, number>> = {
  monomodo: { 1310: 0.35, 1490: 0.3, 1550: 0.25 },
  // El multimodo no se usa en GPON, pero se modela para completitud (850/1300nm
  // se aproximan a las ventanas disponibles).
  multimodo: { 1310: 1.0, 1490: 1.0, 1550: 1.0 },
};

/**
 * Pérdida de inserción típica de un splitter óptico por ratio de división (dB).
 * Incluye el reparto teórico (10·log10(N)) + exceso de inserción real.
 */
export const SPLITTER_LOSS_DB: Record<SplitRatio, number> = {
  2: 3.5,
  4: 7.2,
  8: 10.5,
  16: 13.5,
  32: 17.0,
  64: 21.0,
  128: 25.0,
};

/** Pérdida por par de conectores (dB). */
export const CONNECTOR_LOSS_DB = 0.5;
/** Pérdida por empalme de fusión (dB). */
export const SPLICE_LOSS_DB = 0.1;
/** Margen de seguridad recomendado por diseño (dB). */
export const SAFETY_MARGIN_DB = 3;

/** Clases de potencia GPON (presupuesto total OLT↔ONU en dB) — ITU-T G.984.2. */
export const GPON_CLASSES = {
  'A': 20,
  'B': 25,
  'B+': 28,
  'C+': 32,
} as const;
export type GponClass = keyof typeof GPON_CLASSES;

/** Potencia/sensibilidad por defecto de un OLT/ONU clase B+ (dBm). */
export const DEFAULT_OLT_TX_DBM = 3; // +3 dBm típico salida OLT B+
export const DEFAULT_ONU_RX_SENSITIVITY_DBM = -28; // sensibilidad mínima ONU B+

/** Elemento de la cadena óptica que aporta pérdida. */
export type OpticalElement =
  | {
      tipo: 'fibra';
      etiqueta?: string;
      longitudM: number;
      modo?: 'monomodo' | 'multimodo';
      /** Override de atenuación (dB/km). Si no, se usa la tabla por modo/λ. */
      atenuacionDbKm?: number;
    }
  | { tipo: 'splitter'; etiqueta?: string; ratio: SplitRatio; cantidad?: number }
  | { tipo: 'empalme'; etiqueta?: string; cantidad?: number; perdidaDb?: number }
  | { tipo: 'conector'; etiqueta?: string; cantidad?: number; perdidaDb?: number };

export interface LinkBudgetInput {
  /** Potencia de salida del transmisor (OLT), en dBm. */
  txPowerDbm?: number;
  /** Sensibilidad mínima del receptor (ONU), en dBm. */
  rxSensitivityDbm?: number;
  /** Longitud de onda de cálculo (nm). */
  wavelength?: Wavelength;
  /** Margen de seguridad a reservar (dB). */
  margenSeguridadDb?: number;
  /** Elementos de la cadena óptica, en orden OLT → cliente. */
  elementos: OpticalElement[];
}

export interface BudgetBreakdown {
  etiqueta: string;
  tipo: OpticalElement['tipo'];
  db: number;
}

export interface LinkBudgetResult {
  /** Pérdida total acumulada de la cadena (dB). */
  perdidaTotalDb: number;
  /** Desglose por elemento para auditar el cálculo. */
  desglose: BudgetBreakdown[];
  /** Presupuesto disponible = txPower − rxSensitivity (dB). */
  presupuestoDb: number;
  /** Potencia estimada en el receptor = txPower − pérdidaTotal (dBm). */
  potenciaRxDbm: number;
  /**
   * Margen final (dB) = potenciaRx − rxSensitivity − margenSeguridad.
   * ≥ 0 → enlace viable con reserva. < 0 → el enlace falla.
   */
  margenDb: number;
  viable: boolean;
  /** Semáforo de salud del enlace para la UI. */
  salud: 'verde' | 'amarillo' | 'rojo';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pérdida (dB) de un tramo de fibra. */
export function fiberLoss(
  longitudM: number,
  wavelength: Wavelength = 1310,
  modo: 'monomodo' | 'multimodo' = 'monomodo',
  atenuacionDbKm?: number,
): number {
  const dbKm = atenuacionDbKm ?? FIBER_ATTENUATION_DB_KM[modo][wavelength];
  return round2((Math.max(0, longitudM) / 1000) * dbKm);
}

/** Pérdida (dB) de un splitter por ratio. */
export function splitterLoss(ratio: SplitRatio): number {
  return SPLITTER_LOSS_DB[ratio] ?? 0;
}

/** Pérdida (dB) de un elemento individual de la cadena. */
export function elementLoss(el: OpticalElement, wavelength: Wavelength): number {
  switch (el.tipo) {
    case 'fibra':
      return fiberLoss(el.longitudM, wavelength, el.modo ?? 'monomodo', el.atenuacionDbKm);
    case 'splitter':
      return round2(splitterLoss(el.ratio) * (el.cantidad ?? 1));
    case 'empalme':
      return round2((el.perdidaDb ?? SPLICE_LOSS_DB) * (el.cantidad ?? 1));
    case 'conector':
      return round2((el.perdidaDb ?? CONNECTOR_LOSS_DB) * (el.cantidad ?? 1));
  }
}

/**
 * Calcula el presupuesto óptico completo de una cadena OLT → cliente.
 * Devuelve pérdida total, potencia en recepción, margen y semáforo de salud.
 */
export function linkBudget(input: LinkBudgetInput): LinkBudgetResult {
  const txPowerDbm = input.txPowerDbm ?? DEFAULT_OLT_TX_DBM;
  const rxSensitivityDbm = input.rxSensitivityDbm ?? DEFAULT_ONU_RX_SENSITIVITY_DBM;
  const wavelength = input.wavelength ?? 1310;
  const margenSeguridadDb = input.margenSeguridadDb ?? SAFETY_MARGIN_DB;

  const desglose: BudgetBreakdown[] = [];
  let perdidaTotalDb = 0;
  for (const el of input.elementos) {
    const db = elementLoss(el, wavelength);
    perdidaTotalDb += db;
    desglose.push({
      etiqueta: el.etiqueta ?? defaultLabel(el),
      tipo: el.tipo,
      db,
    });
  }
  perdidaTotalDb = round2(perdidaTotalDb);

  const presupuestoDb = round2(txPowerDbm - rxSensitivityDbm);
  const potenciaRxDbm = round2(txPowerDbm - perdidaTotalDb);
  const margenDb = round2(potenciaRxDbm - rxSensitivityDbm - margenSeguridadDb);

  // Semáforo: rojo si no llega señal; amarillo si llega pero sin margen de
  // reserva (riesgo a futuro); verde si hay margen suficiente.
  let salud: 'verde' | 'amarillo' | 'rojo';
  if (potenciaRxDbm < rxSensitivityDbm) salud = 'rojo';
  else if (margenDb < 0) salud = 'amarillo';
  else salud = 'verde';

  return {
    perdidaTotalDb,
    desglose,
    presupuestoDb,
    potenciaRxDbm,
    margenDb,
    viable: potenciaRxDbm >= rxSensitivityDbm,
    salud,
  };
}

function defaultLabel(el: OpticalElement): string {
  switch (el.tipo) {
    case 'fibra':
      return `Fibra ${el.longitudM} m`;
    case 'splitter':
      return `Splitter 1:${el.ratio}`;
    case 'empalme':
      return `Empalme ×${el.cantidad ?? 1}`;
    case 'conector':
      return `Conector ×${el.cantidad ?? 1}`;
  }
}
