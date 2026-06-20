import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService } from '../accounting/posting-engine.service';

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
    private readonly posting: PostingEngineService,
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
        const asiento = await this.posting.post({
          evento: 'depreciation.posted',
          sourceModule: 'assets',
          fecha,
          tipo: 'depreciacion',
          descripcion: `Depreciación ${periodo} - ${a.nombre}`,
          referencia: { tipo: 'depreciacion', id: a.id },
          lineas: [
            { cuenta: a.cuentaGasto, debito: cuota, descripcion: `Depreciación ${a.nombre}` },
            { cuenta: a.cuentaDepAcum, credito: cuota, descripcion: `Dep. acum. ${a.nombre}` },
          ],
          actor: opts.actor,
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

  /**
   * Da de baja un activo fijo (retiro o venta) y contabiliza (III.3.F):
   *  Dr depreciación acumulada (lo depreciado)
   *  Dr banco/caja (si hay venta)
   *  Cr activo (valor de adquisición)
   *  + cuadre: pérdida (Dr 531025) o utilidad (Cr 424540) en venta/retiro de PPE.
   */
  async darDeBaja(id: string, input: { motivo?: string; valorVenta?: number; cuentaBanco?: string; actor?: string }) {
    const a = await this.prisma.activoFijo.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Activo no encontrado.');
    if (a.estado === 'baja') throw new BadRequestException('El activo ya está dado de baja.');

    const valorAdq = round2(D(a.valorAdquisicion));
    const depAcum = round2(D(a.depreciacionAcumulada));
    const valorVenta = round2(D(input.valorVenta));
    const valorLibros = round2(valorAdq - depAcum);

    await this.asegurarCuenta('531025', 'Pérdida en venta/retiro de PPE');
    await this.asegurarCuenta('424540', 'Utilidad en venta de PPE');

    const lineas: any[] = [];
    if (depAcum > 0) lineas.push({ cuenta: a.cuentaDepAcum, debito: depAcum, descripcion: 'Depreciación acumulada' });
    if (valorVenta > 0) lineas.push({ cuenta: input.cuentaBanco || '111005', debito: valorVenta, descripcion: 'Producto de la venta' });
    lineas.push({ cuenta: a.cuentaActivo, credito: valorAdq, descripcion: `Baja activo ${a.nombre}` });

    const diff = round2(valorLibros - valorVenta); // >0 pérdida ; <0 utilidad
    if (diff > 0) lineas.push({ cuenta: '531025', debito: diff, descripcion: 'Pérdida en baja/venta de PPE' });
    else if (diff < 0) lineas.push({ cuenta: '424540', credito: -diff, descripcion: 'Utilidad en venta de PPE' });

    const asiento = await this.posting.post({
      evento: 'asset.disposed',
      sourceModule: 'assets',
      tipo: 'ajuste',
      descripcion: `Baja de activo ${a.nombre}${input.motivo ? ': ' + input.motivo : ''}${valorVenta > 0 ? ` (venta ${valorVenta})` : ''}`,
      referencia: { tipo: 'baja_activo', id: a.id },
      lineas,
      actor: input.actor,
    });
    await this.prisma.activoFijo.update({ where: { id }, data: { estado: 'baja' } });
    return { ok: true, asiento: asiento.numero, valorLibros, valorVenta, resultado: diff > 0 ? 'perdida' : diff < 0 ? 'utilidad' : 'neutro' };
  }

  private async asegurarCuenta(codigo: string, nombre: string) {
    const existe = await this.prisma.cuentaContable.findUnique({ where: { codigo } });
    if (!existe) { try { await this.accounting.crearCuenta({ codigo, nombre, imputable: true }); } catch { /* carrera */ } }
  }
}
