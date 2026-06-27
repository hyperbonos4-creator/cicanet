import fc from 'fast-check';
import {
  freePorts,
  semaphore,
  isValidCapacity,
  assertValidUsedPorts,
  CapacityError,
} from './capacity';

describe('capacity (Requisitos 9.1–9.5)', () => {
  // Property 13: Cálculo de puertos libres — Validates: Requirements 9.1
  it('Property 13: libres = total − usados para capacidades válidas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (total, usados) => {
          fc.pre(usados <= total);
          expect(freePorts(total, usados)).toBe(total - usados);
        },
      ),
    );
  });

  // Property 14: Semáforo de capacidad — Validates: Requirements 9.2, 9.3, 9.4
  it('Property 14: el semáforo respeta los umbrales 75% / 100%', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (total, usados) => {
          fc.pre(usados <= total);
          const s = semaphore(total, usados);
          const ratio = usados / total;
          if (usados === total) expect(s).toBe('rojo');
          else if (ratio < 0.75) expect(s).toBe('verde');
          else expect(s).toBe('amarillo');
        },
      ),
    );
  });

  // Property 15: Rechazo de capacidad inválida — Validates: Requirements 9.5
  it('Property 15: usados > total se rechaza', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (total, extra) => {
          const usados = total + extra; // estrictamente mayor que total
          expect(isValidCapacity(total, usados)).toBe(false);
          expect(() => assertValidUsedPorts(total, usados)).toThrow(CapacityError);
          expect(() => semaphore(total, usados)).toThrow(CapacityError);
        },
      ),
    );
  });

  it('casos límite del semáforo', () => {
    expect(semaphore(100, 0)).toBe('verde');
    expect(semaphore(100, 74)).toBe('verde');
    expect(semaphore(100, 75)).toBe('amarillo');
    expect(semaphore(100, 99)).toBe('amarillo');
    expect(semaphore(100, 100)).toBe('rojo');
    expect(semaphore(0, 0)).toBe('rojo');
  });
});
