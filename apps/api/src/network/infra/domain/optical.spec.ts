import {
  fiberLoss,
  splitterLoss,
  linkBudget,
  FIBER_ATTENUATION_DB_KM,
  SPLITTER_LOSS_DB,
  type OpticalElement,
} from './optical';

describe('optical (presupuesto óptico GPON/FTTH)', () => {
  describe('fiberLoss', () => {
    it('usa la atenuación monomodo @1310nm por defecto', () => {
      // 2 km × 0.35 dB/km = 0.7 dB
      expect(fiberLoss(2000, 1310, 'monomodo')).toBeCloseTo(0.7, 5);
    });

    it('respeta el override de atenuación', () => {
      // 1 km × 0.2 dB/km = 0.2 dB
      expect(fiberLoss(1000, 1550, 'monomodo', 0.2)).toBeCloseTo(0.2, 5);
    });

    it('nunca devuelve pérdida negativa', () => {
      expect(fiberLoss(-500)).toBe(0);
    });

    it('1550nm atenúa menos que 1310nm para la misma distancia', () => {
      expect(fiberLoss(10000, 1550)).toBeLessThan(fiberLoss(10000, 1310));
    });
  });

  describe('splitterLoss', () => {
    it('mapea ratios estándar a sus pérdidas de inserción', () => {
      expect(splitterLoss(8)).toBe(SPLITTER_LOSS_DB[8]);
      expect(splitterLoss(32)).toBe(17.0);
    });

    it('la pérdida crece con el ratio de división', () => {
      expect(splitterLoss(4)).toBeLessThan(splitterLoss(8));
      expect(splitterLoss(8)).toBeLessThan(splitterLoss(16));
      expect(splitterLoss(32)).toBeLessThan(splitterLoss(64));
    });
  });

  describe('linkBudget', () => {
    it('calcula un enlace GPON B+ típico 1:32 como viable', () => {
      // OLT +3 dBm, ONU −28 dBm, 5 km fibra, 1 splitter 1:32, 2 conectores, 3 empalmes
      const elementos: OpticalElement[] = [
        { tipo: 'fibra', longitudM: 5000 },
        { tipo: 'splitter', ratio: 32 },
        { tipo: 'conector', cantidad: 2 },
        { tipo: 'empalme', cantidad: 3 },
      ];
      const r = linkBudget({ elementos });
      // Pérdidas: 5km×0.35=1.75 + 17 + 2×0.5=1.0 + 3×0.1=0.3 = 20.05 dB
      expect(r.perdidaTotalDb).toBeCloseTo(20.05, 2);
      // Presupuesto B+ = 3 − (−28) = 31 dB
      expect(r.presupuestoDb).toBe(31);
      // Potencia Rx = 3 − 20.05 = −17.05 dBm, por encima de −28 → viable
      expect(r.potenciaRxDbm).toBeCloseTo(-17.05, 2);
      expect(r.viable).toBe(true);
      expect(r.salud).toBe('verde');
    });

    it('marca rojo cuando la potencia en recepción cae bajo la sensibilidad', () => {
      // Cadena excesiva: 30 km + dos splitters 1:64 → supera el presupuesto
      const r = linkBudget({
        elementos: [
          { tipo: 'fibra', longitudM: 30000 },
          { tipo: 'splitter', ratio: 64 },
          { tipo: 'splitter', ratio: 64 },
        ],
      });
      expect(r.viable).toBe(false);
      expect(r.salud).toBe('rojo');
      expect(r.margenDb).toBeLessThan(0);
    });

    it('marca amarillo cuando llega señal pero sin margen de reserva', () => {
      // Ajustado para que potenciaRx ≥ sensibilidad pero margen < 0.
      // tx 3, rxSens −28, margen seg 3. Necesitamos pérdida entre 28 y 31.
      const r = linkBudget({
        elementos: [
          { tipo: 'fibra', longitudM: 1000 }, // 0.35
          { tipo: 'splitter', ratio: 64 }, // 21
          { tipo: 'splitter', ratio: 8 }, // 10.5 → total 31.85... ajustamos
        ],
      });
      // total = 0.35 + 21 + 10.5 = 31.85 → rxPower = -28.85 < -28 → rojo
      // Verificamos el caso amarillo con una cadena calibrada:
      const r2 = linkBudget({
        elementos: [
          { tipo: 'fibra', longitudM: 2000 }, // 0.7
          { tipo: 'splitter', ratio: 64 }, // 21
          { tipo: 'splitter', ratio: 4 }, // 7.2 → total 28.9
        ],
      });
      // rxPower = 3 − 28.9 = −25.9 ≥ −28 → viable, pero margen = −25.9+28−3 = −0.9 < 0
      expect(r2.viable).toBe(true);
      expect(r2.margenDb).toBeLessThan(0);
      expect(r2.salud).toBe('amarillo');
      expect(r.salud).toBe('rojo');
    });

    it('el desglose suma exactamente la pérdida total', () => {
      const r = linkBudget({
        elementos: [
          { tipo: 'fibra', longitudM: 3000 },
          { tipo: 'splitter', ratio: 16 },
          { tipo: 'conector', cantidad: 4 },
        ],
      });
      const suma = r.desglose.reduce((s, d) => s + d.db, 0);
      expect(Math.round(suma * 100) / 100).toBeCloseTo(r.perdidaTotalDb, 2);
    });
  });

  it('expone tablas de referencia de industria coherentes', () => {
    expect(FIBER_ATTENUATION_DB_KM.monomodo[1310]).toBe(0.35);
    expect(FIBER_ATTENUATION_DB_KM.monomodo[1550]).toBe(0.25);
  });
});
