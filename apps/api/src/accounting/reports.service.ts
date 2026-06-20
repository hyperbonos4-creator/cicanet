import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reportes financieros derivados de los movimientos contabilizados (la fuente de
 * verdad son las líneas, no un saldo precalculado). Todos filtran
 * `asiento.estado = 'contabilizado'` (los borradores y anulados no suman).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Suma de débitos/créditos por cuenta imputable. `hasta` acumula hasta ese periodo. */
  private async sumarPorCuenta(opts: { periodo?: string; hasta?: string }) {
    const where: Prisma.MovimientoContableWhereInput = {
      asiento: { estado: 'contabilizado' },
    };
    if (opts.periodo) where.asiento = { estado: 'contabilizado', periodo: opts.periodo };
    if (opts.hasta) where.asiento = { estado: 'contabilizado', periodo: { lte: opts.hasta } };

    const grupos = await this.prisma.movimientoContable.groupBy({
      by: ['cuentaCodigo'],
      where,
      _sum: { debito: true, credito: true },
    });
    return grupos.map((g) => ({
      codigo: g.cuentaCodigo,
      debito: round2(D(g._sum.debito)),
      credito: round2(D(g._sum.credito)),
    }));
  }

  /** Balance de comprobación (sumas y saldos) por cuenta imputable. */
  async balanceComprobacion(periodo?: string) {
    const sumas = await this.sumarPorCuenta(periodo ? { hasta: periodo } : {});
    const cuentas = await this.prisma.cuentaContable.findMany({
      where: { codigo: { in: sumas.map((s) => s.codigo) } },
    });
    const byCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
    const filas = sumas
      .map((s) => {
        const c = byCodigo.get(s.codigo);
        const saldoBruto = s.debito - s.credito;
        const naturaleza = c?.naturaleza ?? 'debito';
        const saldo = naturaleza === 'debito' ? saldoBruto : -saldoBruto;
        return {
          codigo: s.codigo,
          nombre: c?.nombre ?? s.codigo,
          clase: c?.clase ?? parseInt(s.codigo[0], 10),
          naturaleza,
          debitos: s.debito,
          creditos: s.credito,
          saldo: round2(saldo),
          saldoDebito: saldoBruto > 0 ? round2(saldoBruto) : 0,
          saldoCredito: saldoBruto < 0 ? round2(-saldoBruto) : 0,
        };
      })
      .sort((a, b) => a.codigo.localeCompare(b.codigo));

    const totales = filas.reduce(
      (acc, f) => ({
        debitos: round2(acc.debitos + f.debitos),
        creditos: round2(acc.creditos + f.creditos),
        saldoDebito: round2(acc.saldoDebito + f.saldoDebito),
        saldoCredito: round2(acc.saldoCredito + f.saldoCredito),
      }),
      { debitos: 0, creditos: 0, saldoDebito: 0, saldoCredito: 0 },
    );
    return { periodo: periodo ?? 'acumulado', filas, totales, cuadra: totales.saldoDebito === totales.saldoCredito };
  }

  /** Estado de resultados del periodo (ingresos − costos − gastos). */
  async estadoResultados(periodo: string) {
    const sumas = await this.sumarPorCuenta({ periodo });
    const cuentas = await this.prisma.cuentaContable.findMany({ where: { codigo: { in: sumas.map((s) => s.codigo) } } });
    const byCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

    let ingresos = 0, costos = 0, gastos = 0;
    const detalle: { codigo: string; nombre: string; clase: number; valor: number }[] = [];
    for (const s of sumas) {
      const c = byCodigo.get(s.codigo);
      if (!c) continue;
      if (c.clase === 4) { const v = round2(s.credito - s.debito); ingresos += v; detalle.push({ codigo: c.codigo, nombre: c.nombre, clase: 4, valor: v }); }
      else if (c.clase === 5) { const v = round2(s.debito - s.credito); gastos += v; detalle.push({ codigo: c.codigo, nombre: c.nombre, clase: 5, valor: v }); }
      else if (c.clase === 6 || c.clase === 7) { const v = round2(s.debito - s.credito); costos += v; detalle.push({ codigo: c.codigo, nombre: c.nombre, clase: c.clase, valor: v }); }
    }
    ingresos = round2(ingresos); costos = round2(costos); gastos = round2(gastos);
    const utilidadBruta = round2(ingresos - costos);
    const utilidadNeta = round2(utilidadBruta - gastos);
    return {
      periodo,
      ingresos,
      costos,
      gastos,
      utilidadBruta,
      utilidadNeta,
      detalle: detalle.sort((a, b) => a.codigo.localeCompare(b.codigo)),
    };
  }

  /** Balance general acumulado hasta el periodo (Activo = Pasivo + Patrimonio + Resultado). */
  async balanceGeneral(hasta: string) {
    const sumas = await this.sumarPorCuenta({ hasta });
    const cuentas = await this.prisma.cuentaContable.findMany({ where: { codigo: { in: sumas.map((s) => s.codigo) } } });
    const byCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

    let activo = 0, pasivo = 0, patrimonio = 0, ingresos = 0, costosGastos = 0;
    const grupos: Record<string, { codigo: string; nombre: string; saldo: number }[]> = { activo: [], pasivo: [], patrimonio: [] };

    for (const s of sumas) {
      const c = byCodigo.get(s.codigo);
      if (!c) continue;
      const neto = s.debito - s.credito;
      if (c.clase === 1) { const v = round2(neto); activo += v; grupos.activo.push({ codigo: c.codigo, nombre: c.nombre, saldo: v }); }
      else if (c.clase === 2) { const v = round2(-neto); pasivo += v; grupos.pasivo.push({ codigo: c.codigo, nombre: c.nombre, saldo: v }); }
      else if (c.clase === 3) { const v = round2(-neto); patrimonio += v; grupos.patrimonio.push({ codigo: c.codigo, nombre: c.nombre, saldo: v }); }
      else if (c.clase === 4) ingresos += round2(-neto);
      else if (c.clase === 5 || c.clase === 6 || c.clase === 7) costosGastos += round2(neto);
    }
    const resultadoEjercicio = round2(ingresos - costosGastos);
    activo = round2(activo); pasivo = round2(pasivo); patrimonio = round2(patrimonio);
    const patrimonioTotal = round2(patrimonio + resultadoEjercicio);
    const pasivoMasPatrimonio = round2(pasivo + patrimonioTotal);
    return {
      hasta,
      activo,
      pasivo,
      patrimonio: patrimonioTotal,
      resultadoEjercicio,
      pasivoMasPatrimonio,
      cuadra: activo === pasivoMasPatrimonio,
      grupos,
    };
  }

  /** Libro mayor de una cuenta: movimientos y saldo corrido. */
  async libroMayor(codigo: string, periodo?: string) {
    const where: Prisma.MovimientoContableWhereInput = {
      cuentaCodigo: codigo,
      asiento: { estado: 'contabilizado', ...(periodo ? { periodo } : {}) },
    };
    const movs = await this.prisma.movimientoContable.findMany({
      where,
      include: { asiento: true, tercero: true },
      orderBy: [{ asiento: { fecha: 'asc' } }, { orden: 'asc' }],
      take: 1000,
    });
    const cuenta = await this.prisma.cuentaContable.findUnique({ where: { codigo } });
    let saldo = 0;
    const filas = movs.map((m) => {
      const delta = cuenta?.naturaleza === 'credito' ? D(m.credito) - D(m.debito) : D(m.debito) - D(m.credito);
      saldo = round2(saldo + delta);
      return {
        fecha: m.asiento.fecha.toISOString().slice(0, 10),
        comprobante: m.asiento.numero,
        descripcion: m.descripcion ?? m.asiento.descripcion,
        tercero: m.tercero?.nombre ?? null,
        debito: D(m.debito),
        credito: D(m.credito),
        saldo,
      };
    });
    return { cuenta: cuenta ? { codigo: cuenta.codigo, nombre: cuenta.nombre, naturaleza: cuenta.naturaleza } : null, movimientos: filas, saldoFinal: saldo };
  }

  /** Resumen para el dashboard contable. */
  async dashboard(periodo: string) {
    const [pyg, bal, asientos] = await Promise.all([
      this.estadoResultados(periodo),
      this.balanceComprobacion(periodo),
      this.prisma.asientoContable.count({ where: { periodo, estado: 'contabilizado' } }),
    ]);
    // Cartera = saldo deudor de clientes (130505) acumulado.
    const cartera = bal.filas.find((f) => f.codigo === '130505')?.saldo ?? 0;
    const bancosCaja = bal.filas
      .filter((f) => f.codigo.startsWith('11'))
      .reduce((s, f) => round2(s + f.saldo), 0);
    return {
      periodo,
      ingresos: pyg.ingresos,
      gastos: round2(pyg.gastos + pyg.costos),
      utilidadNeta: pyg.utilidadNeta,
      cartera: round2(cartera),
      bancosCaja,
      asientosDelPeriodo: asientos,
    };
  }
}
