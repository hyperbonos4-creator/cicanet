// Validación pura de activos (Requisitos 1.1, 1.4, 1.5, 1.7).
// Funciones sin efectos secundarios: reciben datos y devuelven errores legibles.

import {
  ASSET_STATUSES,
  ASSET_TYPES,
  OWNERSHIP_REGIMES,
  type AssetStatus,
  type AssetType,
  type OwnershipRegime,
} from './types';

export interface AssetValidationInput {
  tipo?: unknown;
  estado?: unknown;
  lng?: unknown;
  lat?: unknown;
  propio?: unknown;
  regimen?: unknown;
}

export class AssetValidationError extends Error {
  constructor(
    message: string,
    /** Campo o causa que originó el error (útil para UI/tests). */
    public readonly field: string,
  ) {
    super(message);
    this.name = 'AssetValidationError';
  }
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** ¿`tipo` pertenece al dominio cerrado de tipos de activo? */
export function isValidAssetType(tipo: unknown): tipo is AssetType {
  return typeof tipo === 'string' && (ASSET_TYPES as string[]).includes(tipo);
}

/** ¿`estado` pertenece al dominio cerrado de estados? */
export function isValidAssetStatus(estado: unknown): estado is AssetStatus {
  return typeof estado === 'string' && (ASSET_STATUSES as string[]).includes(estado);
}

/** ¿`regimen` pertenece al dominio cerrado de regímenes de propiedad? */
export function isValidRegime(regimen: unknown): regimen is OwnershipRegime {
  return typeof regimen === 'string' && (OWNERSHIP_REGIMES as string[]).includes(regimen);
}

/** ¿Coordenadas geográficas válidas (lng ∈ [-180,180], lat ∈ [-90,90])? */
export function hasValidCoordinates(lng: unknown, lat: unknown): boolean {
  return (
    isFiniteNumber(lng) &&
    isFiniteNumber(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Valida un activo y devuelve el primer error encontrado, o `null` si es válido.
 * Reglas:
 *  - tipo obligatorio y dentro del dominio (R1.1, R1.7).
 *  - estado, si se provee, dentro del dominio (R1.4).
 *  - coordenadas GPS obligatorias y válidas (R1.7).
 *  - si `propio === false`, el régimen es obligatorio y válido (R1.5).
 */
export function validateAsset(input: AssetValidationInput): AssetValidationError | null {
  if (input.tipo === undefined || input.tipo === null || input.tipo === '') {
    return new AssetValidationError('El tipo de activo es obligatorio.', 'tipo');
  }
  if (!isValidAssetType(input.tipo)) {
    return new AssetValidationError(
      `Tipo de activo inválido: "${String(input.tipo)}".`,
      'tipo',
    );
  }

  if (input.estado !== undefined && input.estado !== null && !isValidAssetStatus(input.estado)) {
    return new AssetValidationError(
      `Estado de activo inválido: "${String(input.estado)}".`,
      'estado',
    );
  }

  if (!hasValidCoordinates(input.lng, input.lat)) {
    return new AssetValidationError(
      'Las coordenadas GPS (lng, lat) son obligatorias y deben ser válidas.',
      'coordenadas',
    );
  }

  if (input.propio === false) {
    if (input.regimen === undefined || input.regimen === null || input.regimen === '') {
      return new AssetValidationError(
        'El régimen de propiedad es obligatorio cuando el activo no es propio.',
        'regimen',
      );
    }
    if (!isValidRegime(input.regimen)) {
      return new AssetValidationError(
        `Régimen de propiedad inválido: "${String(input.regimen)}".`,
        'regimen',
      );
    }
  }

  return null;
}

/** Variante que lanza en vez de devolver (para uso en servicios). */
export function assertValidAsset(input: AssetValidationInput): void {
  const err = validateAsset(input);
  if (err) throw err;
}
