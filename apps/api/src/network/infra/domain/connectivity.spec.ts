import * as fc from 'fast-check';
import {
  portStats,
  portSemaphore,
  isAssignable,
  tracePath,
  type PortLike,
  type ConnLike,
} from './connectivity';

const stateArb = fc.constantFrom('libre', 'ocupado', 'reservado', 'dañado');
const portArb = (activoId = 'NAP-001') =>
  fc.record({
    id: fc.uuid(),
    activoId: fc.constant(activoId),
    numero: fc.integer({ min: 1, max: 256 }),
    estado: stateArb,
  });

describe('connectivity · portStats', () => {
  // Property: el total siempre es la suma de las categorías y nunca se pierde un puerto.
  it('Property: total = libres + ocupados + reservados + dañados', () => {
    fc.assert(
      fc.property(fc.array(portArb()), (ports) => {
        const s = portStats(ports as PortLike[]);
        expect(s.total).toBe(ports.length);
        expect(s.libres + s.ocupados + s.reservados + s.danados).toBe(s.total);
        expect(s.libres).toBeGreaterThanOrEqual(0);
        expect(s.ocupados).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('connectivity · portSemaphore', () => {
  // Property: sin puertos vendibles (libres = 0) siempre es rojo; con todo libre, verde.
  it('Property: rojo sii libres = 0; verde cuando hay holgura', () => {
    fc.assert(
      fc.property(fc.array(portArb(), { minLength: 1 }), (ports) => {
        const s = portStats(ports as PortLike[]);
        const sem = portSemaphore(s);
        if (s.libres === 0) expect(sem).toBe('rojo');
        if (s.total > 0 && s.libres === s.total) expect(sem).toBe('verde');
      }),
    );
  });

  it('umbral 75% = amarillo', () => {
    // 4 puertos, 3 usados (75%), 1 libre → amarillo.
    const ports: PortLike[] = [
      { id: '1', activoId: 'N', numero: 1, estado: 'ocupado' },
      { id: '2', activoId: 'N', numero: 2, estado: 'ocupado' },
      { id: '3', activoId: 'N', numero: 3, estado: 'ocupado' },
      { id: '4', activoId: 'N', numero: 4, estado: 'libre' },
    ];
    expect(portSemaphore(portStats(ports))).toBe('amarillo');
  });
});

describe('connectivity · isAssignable', () => {
  it('Property: solo los puertos libres son asignables', () => {
    fc.assert(
      fc.property(portArb(), (p) => {
        expect(isAssignable(p as PortLike)).toBe(p.estado === 'libre');
      }),
    );
  });
});

describe('connectivity · tracePath', () => {
  it('anota el puerto usado en cada salto de la cadena', () => {
    // OLT-001 (puerto 2) → NAP-001 (puerto 5). Cadena del cliente: [NAP, OLT].
    const portsByAsset = new Map<string, PortLike[]>([
      ['NAP-001', [{ id: 'pn5', activoId: 'NAP-001', numero: 5, estado: 'ocupado' }]],
      ['OLT-001', [{ id: 'po2', activoId: 'OLT-001', numero: 2, estado: 'ocupado' }]],
    ]);
    const conns: ConnLike[] = [
      { id: 'c1', aPuertoId: 'po2', bPuertoId: 'pn5', estado: 'activa' },
    ];
    const hops = tracePath(['NAP-001', 'OLT-001'], portsByAsset, conns);
    expect(hops.map((h) => h.activoId)).toEqual(['NAP-001', 'OLT-001']);
    expect(hops[0].puertoNumero).toBe(5);
    expect(hops[1].puertoNumero).toBe(2);
  });

  it('Property: el trazado conserva el orden y longitud de la cadena', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 8 }), (chain) => {
        const hops = tracePath(chain, new Map(), []);
        expect(hops.map((h) => h.activoId)).toEqual(chain);
      }),
    );
  });
});
