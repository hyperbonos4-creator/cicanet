import fc from 'fast-check';
import {
  nearestNap,
  isFeasible,
  evaluateConstruction,
  type NapCandidate,
} from './construction';

const arbNap = (i: number) =>
  fc.record({
    id: fc.constant(`NAP-${String(i).padStart(3, '0')}`),
    puertosLibres: fc.integer({ min: 0, max: 16 }),
    distanciaTendido: fc.integer({ min: 0, max: 5000 }),
    distanciaMax: fc.integer({ min: 50, max: 3000 }),
  });

const arbNaps = () =>
  fc.integer({ min: 1, max: 12 }).chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => arbNap(i))),
  );

describe('construction (Requisitos 13.1–13.4)', () => {
  // Property 22: NAP más cercana por distancia de tendido — Validates: Requirements 13.1
  it('Property 22: nearestNap minimiza la distancia de tendido', () => {
    fc.assert(
      fc.property(arbNaps(), (naps: NapCandidate[]) => {
        const best = nearestNap(naps)!;
        const min = Math.min(...naps.map((n) => n.distanciaTendido));
        expect(best.distanciaTendido).toBe(min);
      }),
    );
  });

  // Property 23: Viabilidad de instalación con causa — Validates: Requirements 13.3, 13.4
  it('Property 23: instalable sii libres≥1 y distancia≤max; si no, causa correcta', () => {
    fc.assert(
      fc.property(arbNaps(), (naps: NapCandidate[]) => {
        const evalr = evaluateConstruction(naps);
        const nap = evalr.nap!;
        const feasible = nap.puertosLibres >= 1 && nap.distanciaTendido <= nap.distanciaMax;
        if (feasible) {
          expect(evalr.resultado).toBe('instalable');
          expect(evalr.causa).toBeNull();
        } else {
          expect(evalr.resultado).toBe('no_instalable');
          if (nap.puertosLibres < 1) expect(evalr.causa).toBe('sin_puertos');
          else expect(evalr.causa).toBe('fuera_de_alcance');
        }
        // costo y tiempo siempre presentes cuando hay NAP.
        expect(evalr.costoEstimado).not.toBeNull();
        expect(evalr.tiempoEstimadoDias).not.toBeNull();
      }),
    );
  });

  it('sin candidatas → no instalable', () => {
    const r = evaluateConstruction([]);
    expect(r.resultado).toBe('no_instalable');
    expect(r.nap).toBeNull();
  });

  it('isFeasible casos límite', () => {
    expect(isFeasible({ id: 'a', puertosLibres: 1, distanciaTendido: 100, distanciaMax: 100 })).toBe(true);
    expect(isFeasible({ id: 'a', puertosLibres: 0, distanciaTendido: 50, distanciaMax: 100 })).toBe(false);
    expect(isFeasible({ id: 'a', puertosLibres: 2, distanciaTendido: 101, distanciaMax: 100 })).toBe(false);
  });
});
