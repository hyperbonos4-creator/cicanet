import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface UpsertPresupuestoInput {
  anio: number;
  periodo?: string | null;
  cuentaCodigo: string;
  centroCosto?: string | null;
  monto: number;
  notas?: string;
  creadoPor?: string;
}

/**
 * Control presupuestal (Presupuesto vs Real — PARTE V). El contador/gerente fija
 * metas por cuenta PUC (y opcionalmente centro de costo); la ejecución real se
 * calcula del ledger en runtime (movimientos contabilizados), con la desviación.
 * El ledger es la fuente de verdad: el presupuesto no genera asientos.
 */
@Injectable()
export class PresupuestoService {
  constructor(private readonly prisma: PrismaService) {}

  async list(anio: number) {
    return this.prisma.presupuesto.findMany({ where: { anio }, orderBy: [{ periodo: 'asc' }, { cuentaCodigo: 'asc' }] });
  }

  async upsert(input: UpsertPresupuestoInput) {
    if (!input.anio || input.anio < 2000) throw new BadRequestException('Año inválido.');
    if (!input.cuentaCodigo) throw new BadRequestException('La cuenta PUC es obligatoria.');
    const cuenta = await this.prisma.cuentaContable.findUnique({ where: { codigo: input.cuentaCodigo } });
    if (!cuenta) throw new BadRequestException(`La cuenta ${input.cuentaCodigo} no existe en el PUC.`);
    if (!cuenta.imputable) throw new BadRequestException('Solo se presupuestan cuentas imputables (de movimiento).');
    if (input.periodo && !/^\d{4}-\d{2}$/.test(input.periodo)) throw new BadRequestException('Periodo inválido (YYYY-MM).');
    if (!Number.isFinite(input.monto)) throw new BadRequestException('Monto inválido.');

    const periodo = input.periodo ?? null;
    const centroCosto = input.centroCosto ?? null;
    // Dedup manual: el @@unique con NULLs no es fiable en Postgres.
    const existente = await this.prisma.presupuesto.findFirst({ where: { anio: input.anio, periodo, cuentaCodigo: input.cuentaCodigo, centroCosto } });
    const data = { monto: new Prisma.Decimal(input.monto), notas: input.notas?.slice(0, 300) ?? null, creadoPor: input.creadoPor ?? null };
    if (existente) return this.prisma.presupuesto.update({ where: { id: existente.id }, data });
    return this.prisma.presupuesto.create({ data: { anio: input.anio, periodo, cuentaCodigo: input.cuentaCodigo, centroCosto, ...data } });
  }

  async eliminar(id: string) {
    const p = await this.prisma.presupuesto.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Línea de presupuesto no encontrada.');
    await this.prisma.presupuesto.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Ejecución presupuestal: compara la meta contra el real del ledger. Si se pasa
   * `periodo`, filtra a ese mes (usa metas mensuales y/o prorratea la anual);
   * si no, compara contra el año completo. La desviación se expresa firmada y en %.
   */
  async ejecucion(anio: number, periodo?: string) {
    const presupuestos = await this.prisma.presupuesto.findMany({ where: { anio } });
    if (presupuestos.length === 0) {
      return { anio, periodo: periodo ?? null, lineas: [], totales: { presupuesto: 0, real: 0, desviacion: 0, desviacionPct: 0 } };
    }

    const codigos = [...new Set(presupuestos.map((p) => p.cuentaCodigo))];
    const cuentas = await this.prisma.cuentaContable.findMany({ where: { codigo: { in: codigos } } });
    const byCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

    // Real del ledger: movimientos contabilizados del año (o mes) por cuenta y centro.
    const periodoFiltro: Prisma.AsientoContableWhereInput = periodo
      ? { periodo, estado: 'contabilizado' }
      : { periodo: { startsWith: `${anio}-` }, estado: 'contabilizado' };

    const movs = await this.prisma.movimientoContable.findMany({
      where: { cuentaCodigo: { in: codigos }, asiento: periodoFiltro },
      select: { cuentaCodigo: true, centroCosto: true, debito: true, credito: true },
    });

    // Agrega real por (cuenta, centro) respetando la naturaleza de la cuenta.
    const realKey = (cuenta: string, centro: string | null) => `${cuenta}|${centro ?? ''}`;
    const realMap = new Map<string, number>();
    for (const m of movs) {
      const c = byCodigo.get(m.cuentaCodigo);
      const signo = c?.naturaleza === 'credito' ? D(m.credito) - D(m.debito) : D(m.debito) - D(m.credito);
      const k = realKey(m.cuentaCodigo, m.centroCosto ?? null);
      realMap.set(k, round2((realMap.get(k) ?? 0) + signo));
      // También acumula a nivel cuenta (centro vacío) para metas sin centro.
      const kc = realKey(m.cuentaCodigo, null);
      if (m.centroCosto) realMap.set(kc, round2((realMap.get(kc) ?? 0) + signo));
    }

    // Si se consulta un mes pero la meta es anual, se prorratea /12 para comparar.
    const factor = (p: { periodo: string | null }) => (periodo && !p.periodo ? 1 / 12 : 1);

    const lineas = presupuestos
      .filter((p) => !periodo || !p.periodo || p.periodo === periodo) // excluye metas de otros meses
      .map((p) => {
        const c = byCodigo.get(p.cuentaCodigo);
        const meta = round2(D(p.monto) * factor(p));
        const real = realMap.get(realKey(p.cuentaCodigo, p.centroCosto ?? null)) ?? 0;
        const desviacion = round2(real - meta);
        const desviacionPct = meta !== 0 ? round2((desviacion / Math.abs(meta)) * 100) : real !== 0 ? 100 : 0;
        // Para gasto/costo, gastar de más es "malo"; para ingreso, ingresar de menos es "malo".
        const esIngreso = (c?.clase ?? 0) === 4;
        const estado: 'bueno' | 'alerta' | 'malo' = (() => {
          const sobre = esIngreso ? desviacion < 0 : desviacion > 0; // desfavorable
          const mag = Math.abs(desviacionPct);
          if (!sobre) return 'bueno';
          return mag > 15 ? 'malo' : 'alerta';
        })();
        return {
          id: p.id,
          cuentaCodigo: p.cuentaCodigo,
          cuentaNombre: c?.nombre ?? p.cuentaCodigo,
          esIngreso,
          centroCosto: p.centroCosto,
          periodo: p.periodo,
          presupuesto: meta,
          real,
          desviacion,
          desviacionPct,
          estado,
          notas: p.notas,
        };
      });

    const totPres = round2(lineas.reduce((s, l) => s + l.presupuesto, 0));
    const totReal = round2(lineas.reduce((s, l) => s + l.real, 0));
    const totDes = round2(totReal - totPres);
    return {
      anio,
      periodo: periodo ?? null,
      lineas,
      totales: { presupuesto: totPres, real: totReal, desviacion: totDes, desviacionPct: totPres !== 0 ? round2((totDes / Math.abs(totPres)) * 100) : 0 },
    };
  }
}
