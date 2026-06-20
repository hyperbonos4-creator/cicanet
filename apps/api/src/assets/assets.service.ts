import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Activos fijos y depreciación automática (línea recta). La corrida mensual
 * genera un asiento por activo (Dr gasto depreciación, Cr depreciación acumulada)
 * y es idempotente por (activo, periodo).
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger('AssetsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  list() {
    return this.prisma.activoFijo.findMany({ orderBy: { creadoEn: 'desc' }, take: 300 });
  }

  async crear(input: { nombre: string; valorAdquisicion: number; vidaUtilMeses: number; fechaAdquisicion?: string; valorResidual?: number; cuentaActivo?: string; cuentaDepAcum?: string; cuentaGasto?: string }) {
    if (!input.nombre?.trim()) throw new BadRequestException('El nombre es obligatorio.');
    if (D(input.valorAdquisicion) <= 0) throw new BadRequestException('El valor de adquisición debe ser mayor a cero.');
    if (!Number.isInteger(input.vidaUtilMeses) || input.vidaUtilMeses <= 0) throw new BadRequestException('La vida útil (meses) debe ser un entero positivo.');
    return this.prisma.activoFijo.create({
      data: {
        nombre: input.nombre.trim(),
        valorAdquisicion: round2(D(input.valorAdquisicion)),
        valorResidual: round2(D(input.valorResidual)),
        vidaUtilMeses: input.vidaUtilMeses,
        fechaAdquisicion: input.fechaAdquisicion ? new Date(input.fechaAdquisicion) : new Date(),
        cuentaActivo: input.cuentaActivo ?? '152805',
        cuentaDepAcum: input.cuentaDepAcum ?? '159205',
        cuentaGasto: input.cuentaGasto ?? '516005',
      },
    });
  }

  /** Cuota mensual (línea recta) pendiente de un activo. */
  private cuotaMensual(a: { valorAdquisicion: any; valorResidual: any; vidaUtilMeses: number; depreciacionAcumulada: any }) {
    const base = round2(D(a.valorAdquisicion) - D(a.valorResidual));
    const cuota = round2(base / a.vidaUtilMeses);
    const restante = round2(base - D(a.depreciacionAcumulada));
    return Math.max(0, Math.min(cuota, restante));
  }

  /** Previsualiza la depreciación del periodo (sin escribir). */
  async preview(periodo: string) {
    this.validarPeriodo(periodo);
    const activos = await this.prisma.activoFijo.findMany({ where: { estado: 'activo' }, include: { registros: { where: { periodo } } } });
    let total = 0;
    const items = activos
      .filter((a) => a.registros.length === 0)
      .map((a) => {
        const cuota = this.cuotaMensual(a);
        total = round2(total + cuota);
        return { id: a.id, nombre: a.nombre, cuota, depreciacionAcumulada: D(a.depreciacionAcumulada), valor: D(a.valorAdquisicion) };
      })
      .filter((x) => x.cuota > 0);
    return { periodo, activos: items.length, totalDepreciacion: total, items };
  }

  /** Ejecuta la depreciación del periodo. */
  async run(periodo: string, opts: { dryRun?: boolean; actor?: string } = {}) {
    this.validarPeriodo(periodo);
    if (opts.dryRun) return { dryRun: true, ...(await this.preview(periodo)) };

    const [anio, mes] = periodo.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, 28));
    const activos = await this.prisma.activoFijo.findMany({ where: { estado: 'activo' }, include: { registros: { where: { periodo } } } });

    let procesados = 0;
    let totalDepreciacion = 0;
    for (const a of activos) {
      if (a.registros.length > 0) continue; // idempotente
      const cuota = this.cuotaMensual(a);
      if (cuota <= 0) continue;
      try {
        const asiento = await this.accounting.crearAsiento({
          fecha,
          tipo: 'depreciacion',
          descripcion: `Depreciación ${periodo} - ${a.nombre}`,
          referenciaTipo: 'depreciacion',
          referenciaId: a.id,
          lineas: [
            { cuenta: a.cuentaGasto, debito: cuota, descripcion: `Depreciación ${a.nombre}` },
            { cuenta: a.cuentaDepAcum, credito: cuota, descripcion: `Dep. acum. ${a.nombre}` },
          ],
          contabilizar: true,
          creadoPor: opts.actor,
        });
        await this.prisma.depreciacionRegistro.create({ data: { activoFijoId: a.id, periodo, valor: cuota, asientoId: asiento.id } });
        const nuevaAcum = round2(D(a.depreciacionAcumulada) + cuota);
        const base = round2(D(a.valorAdquisicion) - D(a.valorResidual));
        await this.prisma.activoFijo.update({
          where: { id: a.id },
          data: { depreciacionAcumulada: nuevaAcum, estado: nuevaAcum >= base ? 'depreciado' : 'activo' },
        });
        procesados++;
        totalDepreciacion = round2(totalDepreciacion + cuota);
      } catch (e: any) {
        if (e?.code !== 'P2002') this.logger.warn(`Depreciación ${a.nombre} falló: ${e.message}`);
      }
    }
    return { dryRun: false, periodo, procesados, totalDepreciacion };
  }

  private validarPeriodo(periodo: string) {
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new BadRequestException('Periodo inválido (YYYY-MM).');
  }
}
