import fc from 'fast-check';
import { connectedHomes, penetration } from './penetration';

describe('penetration (Requisitos 12.2–12.4)', () => {
  // Property 20: Hogares conectados de un sector — Validates: Requirements 12.2
  it('Property 20: hogares conectados = conteo de clientes activos', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ activo: fc.boolean() })), (clients) => {
        const expected = clients.filter((c) => c.activo).length;
        expect(connectedHomes(clients)).toBe(expected);
      }),
    );
  });

  // Property 21: Cálculo de penetración — Validates: Requirements 12.3, 12.4
  it('Property 21: penetración = conectados/estimados*100, o null si estimados = 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (estimados, conectados) => {
          const p = penetration(estimados, conectados);
          if (estimados <= 0) {
            expect(p).toBeNull();
          } else {
            expect(p).toBeCloseTo((conectados / estimados) * 100, 6);
          }
        },
      ),
    );
  });
});
