import {
  simulateFailure,
  criticalityRanking,
  classifySeverity,
  dependencyChain,
  type SimulationContext,
} from './simulation';
import type { TopoNode } from './topology';

// Árbol FTTH: POP → OLT → NAP-1 → {CLI-1, CLI-2}; OLT → NAP-2 → CLI-3
const nodes: TopoNode[] = [
  { id: 'POP', padreId: null, tipo: 'POP' },
  { id: 'OLT', padreId: 'POP', tipo: 'OLT' },
  { id: 'NAP-1', padreId: 'OLT', tipo: 'NAP' },
  { id: 'NAP-2', padreId: 'OLT', tipo: 'NAP' },
  { id: 'CLI-1', padreId: 'NAP-1', tipo: 'Cliente' },
  { id: 'CLI-2', padreId: 'NAP-1', tipo: 'Cliente' },
  { id: 'CLI-3', padreId: 'NAP-2', tipo: 'Cliente' },
];

const ingresoPorCliente = new Map([
  ['CLI-1', 50000],
  ['CLI-2', 70000],
  ['CLI-3', 60000],
]);

describe('simulation (gemelo digital — ¿qué pasa si...?)', () => {
  describe('classifySeverity', () => {
    it('escala por número de clientes', () => {
      expect(classifySeverity(0)).toBe('baja');
      expect(classifySeverity(5)).toBe('media');
      expect(classifySeverity(20)).toBe('alta');
      expect(classifySeverity(120)).toBe('critica');
    });
  });

  describe('simulateFailure', () => {
    const ctx: SimulationContext = { nodes, ingresoPorCliente };

    it('al caer NAP-1 afecta solo a sus clientes (CLI-1, CLI-2)', () => {
      const r = simulateFailure('NAP-1', ctx);
      expect(r.clientesAfectados.sort()).toEqual(['CLI-1', 'CLI-2']);
      expect(r.ingresosEnRiesgo).toBe(120000);
      expect(r.napsAfectadas).toBe(1);
      expect(r.severidad).toBe('media');
      expect(r.activosAfectados).toContain('NAP-1');
    });

    it('al caer la OLT afecta a TODOS los clientes aguas abajo', () => {
      const r = simulateFailure('OLT', ctx);
      expect(r.clientesAfectados.sort()).toEqual(['CLI-1', 'CLI-2', 'CLI-3']);
      expect(r.ingresosEnRiesgo).toBe(180000);
      expect(r.napsAfectadas).toBe(2);
    });

    it('al caer un cliente solo se afecta a sí mismo', () => {
      const r = simulateFailure('CLI-3', ctx);
      expect(r.clientesAfectados).toEqual(['CLI-3']);
      expect(r.ingresosEnRiesgo).toBe(60000);
    });
  });

  describe('criticalityRanking', () => {
    it('ordena los nodos por clientes afectados (SPOF primero)', () => {
      const ranking = criticalityRanking({ nodes, ingresoPorCliente });
      // OLT (3 clientes) debe ir primero, luego POP (también 3, pero OLT/POP
      // empatan en clientes → desempata por ingresos iguales → orden estable).
      const top = ranking[0];
      expect(top.clientesAfectados).toBe(3);
      // No incluye clientes ni ONU como SPOF.
      expect(ranking.every((r) => r.tipo !== 'Cliente')).toBe(true);
    });
  });

  describe('dependencyChain', () => {
    it('lista la cadena de un activo hacia la raíz', () => {
      expect(dependencyChain('CLI-1', nodes)).toEqual(['CLI-1', 'NAP-1', 'OLT', 'POP']);
    });
  });
});
