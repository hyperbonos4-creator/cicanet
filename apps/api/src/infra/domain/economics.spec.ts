import fc from 'fast-check';
import { deployedCapital, isWarrantyExpired } from './economics';

describe('economics (Requisitos 2.2, 2.3)', () => {
  // Property 5: Cálculo del capital desplegado — Validates: Requirements 2.2
  it('Property 5: capital desplegado = Σ(compra + instalación)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            costoCompra: fc.option(fc.double({ min: 0, max: 1e7, noNaN: true }), { nil: undefined }),
            costoInstalacion: fc.option(fc.double({ min: 0, max: 1e7, noNaN: true }), { nil: undefined }),
          }),
        ),
        (items) => {
          const expected = items.reduce(
            (s, e) => s + (e.costoCompra || 0) + (e.costoInstalacion || 0),
            0,
          );
          expect(deployedCapital(items)).toBeCloseTo(expected, 6);
        },
      ),
    );
  });

  // Property 6: Garantía vencida — Validates: Requirements 2.3
  it('Property 6: garantía vencida sii fechaFin < ahora', () => {
    const now = new Date('2026-06-19T00:00:00Z');
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2050-01-01T00:00:00Z') }),
        (fecha) => {
          const expired = isWarrantyExpired(fecha.toISOString(), now);
          expect(expired).toBe(fecha.getTime() < now.getTime());
        },
      ),
    );
  });

  it('sin fecha de garantía no se considera vencida', () => {
    expect(isWarrantyExpired(undefined)).toBe(false);
    expect(isWarrantyExpired('')).toBe(false);
  });
});
