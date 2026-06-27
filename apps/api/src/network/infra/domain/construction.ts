// Modo construcción puro (Requisitos 13.1–13.4).
// Evalúa la viabilidad de instalar un cliente en un punto dado.

export interface NapCandidate {
  id: string;
  /** Puertos libres de la NAP. */
  puertosLibres: number;
  /** Distancia de tendido por rutas (metros) desde el punto a la NAP. */
  distanciaTendido: number;
  /** Distancia máxima de instalación permitida de la NAP (metros). */
  distanciaMax: number;
}

export type ConstructionResult = 'instalable' | 'no_instalable';
export type ConstructionCause = 'sin_puertos' | 'fuera_de_alcance' | null;

export interface ConstructionCostModel {
  /** Costo fijo de instalación. */
  costoBase: number;
  /** Costo por metro de tendido. */
  costoPorMetro: number;
  /** Tiempo base de instalación (días). */
  tiempoBaseDias: number;
  /** Días adicionales por cada metro de tendido. */
  diasPorMetro: number;
}

export const DEFAULT_COST_MODEL: ConstructionCostModel = {
  costoBase: 80000,
  costoPorMetro: 1500,
  tiempoBaseDias: 1,
  diasPorMetro: 1 / 150, // ~1 día extra por cada 150 m
};

export interface ConstructionEvaluation {
  nap: NapCandidate | null;
  distanciaTendido: number | null;
  puertosLibres: number | null;
  costoEstimado: number | null;
  tiempoEstimadoDias: number | null;
  resultado: ConstructionResult;
  causa: ConstructionCause;
}

/**
 * NAP más cercana por Distancia_Tendido. Empate → menor id (determinista).
 * Devuelve null si no hay candidatas.
 */
export function nearestNap(candidates: NapCandidate[]): NapCandidate | null {
  let best: NapCandidate | null = null;
  for (const c of candidates) {
    if (
      best === null ||
      c.distanciaTendido < best.distanciaTendido ||
      (c.distanciaTendido === best.distanciaTendido && c.id < best.id)
    ) {
      best = c;
    }
  }
  return best;
}

/** ¿La NAP es viable? libres ≥ 1 AND distancia ≤ distanciaMax. */
export function isFeasible(nap: NapCandidate): boolean {
  return nap.puertosLibres >= 1 && nap.distanciaTendido <= nap.distanciaMax;
}

/** Causa de inviabilidad (sin puertos tiene prioridad sobre fuera de alcance). */
export function feasibilityCause(nap: NapCandidate): ConstructionCause {
  if (nap.puertosLibres < 1) return 'sin_puertos';
  if (nap.distanciaTendido > nap.distanciaMax) return 'fuera_de_alcance';
  return null;
}

/**
 * Evalúa la construcción para un punto: elige la NAP más cercana por ruta y
 * devuelve viabilidad, distancia, puertos, costo y tiempo estimados.
 */
export function evaluateConstruction(
  candidates: NapCandidate[],
  cost: ConstructionCostModel = DEFAULT_COST_MODEL,
): ConstructionEvaluation {
  const nap = nearestNap(candidates);
  if (!nap) {
    return {
      nap: null,
      distanciaTendido: null,
      puertosLibres: null,
      costoEstimado: null,
      tiempoEstimadoDias: null,
      resultado: 'no_instalable',
      causa: 'fuera_de_alcance',
    };
  }
  const feasible = isFeasible(nap);
  return {
    nap,
    distanciaTendido: nap.distanciaTendido,
    puertosLibres: nap.puertosLibres,
    costoEstimado: Math.round(cost.costoBase + nap.distanciaTendido * cost.costoPorMetro),
    tiempoEstimadoDias:
      Math.round((cost.tiempoBaseDias + nap.distanciaTendido * cost.diasPorMetro) * 10) / 10,
    resultado: feasible ? 'instalable' : 'no_instalable',
    causa: feasible ? null : feasibilityCause(nap),
  };
}
