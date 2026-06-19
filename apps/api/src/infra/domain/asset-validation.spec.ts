import fc from 'fast-check';
import {
  validateAsset,
  isValidAssetType,
  hasValidCoordinates,
} from './asset-validation';
import { ASSET_TYPES, ASSET_STATUSES, OWNERSHIP_REGIMES } from './types';

const validLng = () => fc.double({ min: -180, max: 180, noNaN: true });
const validLat = () => fc.double({ min: -90, max: 90, noNaN: true });

describe('asset-validation (Requisitos 1.1, 1.4, 1.5, 1.7)', () => {
  // Property 1: Validación de campos de enumeración — Validates: Requirements 1.1, 1.4
  it('Property 1: acepta tipo/estado del dominio y rechaza los de fuera', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ASSET_TYPES),
        fc.constantFrom(...ASSET_STATUSES),
        validLng(),
        validLat(),
        (tipo, estado, lng, lat) => {
          expect(validateAsset({ tipo, estado, lng, lat, propio: true })).toBeNull();
        },
      ),
    );

    fc.assert(
      fc.property(
        fc.string().filter((s) => !(ASSET_TYPES as string[]).includes(s)),
        validLng(),
        validLat(),
        (tipo, lng, lat) => {
          const err = validateAsset({ tipo, lng, lat, propio: true });
          expect(err).not.toBeNull();
          expect(err!.field).toBe('tipo');
        },
      ),
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...ASSET_TYPES),
        fc.string().filter((s) => s !== '' && !(ASSET_STATUSES as string[]).includes(s)),
        validLng(),
        validLat(),
        (tipo, estado, lng, lat) => {
          const err = validateAsset({ tipo, estado, lng, lat, propio: true });
          expect(err).not.toBeNull();
          expect(err!.field).toBe('estado');
        },
      ),
    );
  });

  // Property 2: Régimen obligatorio para activos no propios — Validates: Requirements 1.5
  it('Property 2: activo no propio exige régimen válido', () => {
    // Sin régimen → error de régimen.
    fc.assert(
      fc.property(fc.constantFrom(...ASSET_TYPES), validLng(), validLat(), (tipo, lng, lat) => {
        const err = validateAsset({ tipo, lng, lat, propio: false });
        expect(err).not.toBeNull();
        expect(err!.field).toBe('regimen');
      }),
    );

    // Con régimen válido → sin error.
    fc.assert(
      fc.property(
        fc.constantFrom(...ASSET_TYPES),
        fc.constantFrom(...OWNERSHIP_REGIMES),
        validLng(),
        validLat(),
        (tipo, regimen, lng, lat) => {
          expect(validateAsset({ tipo, lng, lat, propio: false, regimen })).toBeNull();
        },
      ),
    );

    // Régimen inválido → error de régimen.
    fc.assert(
      fc.property(
        fc.constantFrom(...ASSET_TYPES),
        fc.string().filter((s) => s !== '' && !(OWNERSHIP_REGIMES as string[]).includes(s)),
        validLng(),
        validLat(),
        (tipo, regimen, lng, lat) => {
          const err = validateAsset({ tipo, lng, lat, propio: false, regimen });
          expect(err).not.toBeNull();
          expect(err!.field).toBe('regimen');
        },
      ),
    );
  });

  // Property 3: Obligatoriedad de tipo y coordenadas — Validates: Requirements 1.7
  it('Property 3: rechaza activos sin tipo o sin coordenadas válidas', () => {
    // Sin tipo.
    fc.assert(
      fc.property(validLng(), validLat(), (lng, lat) => {
        const err = validateAsset({ tipo: undefined, lng, lat, propio: true });
        expect(err).not.toBeNull();
        expect(err!.field).toBe('tipo');
      }),
    );

    // Coordenadas fuera de rango o ausentes.
    fc.assert(
      fc.property(
        fc.constantFrom(...ASSET_TYPES),
        fc.oneof(
          fc.constant(undefined),
          fc.double({ min: 180.0001, max: 1e6, noNaN: true }),
          fc.double({ min: -1e6, max: -180.0001, noNaN: true }),
        ),
        (tipo, badLng) => {
          const err = validateAsset({ tipo, lng: badLng as any, lat: 6.27, propio: true });
          expect(err).not.toBeNull();
          expect(err!.field).toBe('coordenadas');
        },
      ),
    );
  });

  it('helpers de dominio cerrados', () => {
    expect(isValidAssetType('NAP')).toBe(true);
    expect(isValidAssetType('XXX')).toBe(false);
    expect(hasValidCoordinates(-75.5, 6.27)).toBe(true);
    expect(hasValidCoordinates(200, 6.27)).toBe(false);
  });
});
