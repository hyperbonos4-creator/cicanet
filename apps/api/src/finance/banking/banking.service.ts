import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService } from '../accounting/posting-engine.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

/**
 * Conciliación bancaria: importa extractos (CSV), los cruza contra los recaudos
 * (PagoTransaccion Wompi) y, al confirmar, genera el asiento contable
 * (Dr Banco, Cr contrapartida). Idempotente por hash (reimportar no duplica).
 */
@Injectable()
export class BankingService {
  private readonly logger = new Logger('BankingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingEngineService,
  ) {}

  // ---- cuentas bancarias ----
  listCuentas() {
    return this.prisma.cuentaBancaria.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } });
  }
  crearCuenta(input: { nombre: string; banco?: string; numero?: string; cuentaPuc: string }) {
    if (!/^11\d{2,}$/.test(input.cuentaPuc)) throw new BadRequestException('La cuenta PUC debe ser del disponible (11xx).');
    return this.prisma.cuentaBancaria.create({ data: { nombre: input.nombre.trim(), banco: input.banco, numero: input.numero, cuentaPuc: input.cuentaPuc } });
  }

  // ---- importación de extracto (CSV) ----
  /**
   * Importa un CSV con columnas flexibles: fecha, descripcion, valor[, referencia].
   * Acepta separador coma o punto y coma; valores con $ y separadores de miles.
   */
  async importarCsv(cuentaBancariaId: string, contenido: string) {
    const cuenta = await this.prisma.cuentaBancaria.findUnique({ where: { id: cuentaBancariaId } });
    if (!cuenta) throw new NotFoundException('Cuenta bancaria no encontrada.');

    const lineas = contenido.split(/\r?\n/).filter((l) => l.trim().length);
    if (!lineas.length) throw new BadRequestException('El archivo está vacío.');

    // Detectar separador y encabezado.
    const sep = (lineas[0].match(/;/g)?.length ?? 0) > (lineas[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const header = lineas[0].toLowerCase();
    const tieneHeader = /fecha|valor|monto|descrip/.test(header);
    const cols = tieneHeader ? this.indexarColumnas(header.split(sep)) : { fecha: 0, descripcion: 1, valor: 2, referencia: 3 };
    const filas = tieneHeader ? lineas.slice(1) : lineas;

    let importados = 0;
    let duplicados = 0;
    const errores: string[] = [];

    for (const fila of filas) {
      const campos = this.parseCsvLine(fila, sep);
      try {
        const fecha = this.parseFecha(campos[cols.fecha]);
        const valor = this.parseValor(campos[cols.valor]);
        const descripcion = (campos[cols.descripcion] ?? '').trim().slice(0, 300) || 'Movimiento';
        const referencia = cols.referencia != null ? (campos[cols.referencia] ?? '').trim().slice(0, 120) : null;
        if (!fecha || valor === null) { errores.push(`Fila ignorada: ${fila.slice(0, 60)}`); continue; }

        const hash = createHash('sha1').update(`${cuentaBancariaId}|${fecha.toISOString().slice(0, 10)}|${valor}|${referencia ?? ''}|${descripcion}`).digest('hex');
        try {
          await this.prisma.movimientoBancario.create({
            data: { cuentaBancariaId, fecha, descripcion, referencia, valor, hash },
          });
          importados++;
        } catch (e: any) {
          if (e?.code === 'P2002') duplicados++;
          else throw e;
        }
      } catch (e: any) {
        errores.push(`Fila inválida: ${fila.slice(0, 60)} (${e.message})`);
      }
    }
    return { importados, duplicados, errores: errores.slice(0, 20), total: filas.length };
  }

  private indexarColumnas(headers: string[]) {
    const idx = (re: RegExp) => headers.findIndex((h) => re.test(h.trim()));
    return {
      fecha: Math.max(0, idx(/fecha|date/)),
      descripcion: Math.max(0, idx(/descrip|concepto|detalle/)),
      valor: Math.max(0, idx(/valor|monto|importe|amount/)),
      referencia: idx(/refer|documento|comprobante/) >= 0 ? idx(/refer|documento|comprobante/) : undefined,
    } as { fecha: number; descripcion: number; valor: number; referencia?: number };
  }

  private parseCsvLine(line: string, sep: string): string[] {
    // Parser simple con soporte de comillas.
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  private parseFecha(s?: string): Date | null {
    if (!s) return null;
    const t = s.trim();
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t); // YYYY-MM-DD
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t); // DD/MM/YYYY
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseValor(s?: string): number | null {
    if (s == null) return null;
    let t = s.replace(/[$\s]/g, '');
    if (!t) return null;
    // Manejar miles/decimales: si hay coma decimal (1.234,56) -> normalizar.
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? round2(n) : null;
  }

  // ---- conciliación ----
  async sinConciliar(cuentaBancariaId?: string) {
    return this.prisma.movimientoBancario.findMany({
      where: { estado: 'sin_conciliar', cuentaBancariaId },
      orderBy: { fecha: 'desc' },
      take: 500,
    });
  }

  /** Sugerencias de recaudo (PagoTransaccion APROBADA) que cuadran con un movimiento. */
  async sugerencias(movimientoId: string) {
    const mov = await this.prisma.movimientoBancario.findUnique({ where: { id: movimientoId } });
    if (!mov) throw new NotFoundException('Movimiento no encontrado.');
    const valor = D(mov.valor);
    if (valor <= 0) return { movimiento: mov, sugerencias: [] }; // solo entradas se concilian con recaudos
    const cents = Math.round(valor * 100);
    const tol = 100; // tolerancia ±$1 (100 centavos) para diferencias de redondeo
    const ventana = 5 * DAY;
    const desde = new Date(mov.fecha.getTime() - ventana);
    const hasta = new Date(mov.fecha.getTime() + ventana);

    const candidatos = await this.prisma.pagoTransaccion.findMany({
      where: { estado: 'APROBADA', montoCents: { gte: cents - tol, lte: cents + tol }, creadoEn: { gte: desde, lte: hasta } },
      take: 10,
      orderBy: { creadoEn: 'desc' },
    });
    return {
      movimiento: mov,
      sugerencias: candidatos.map((c) => {
        const dias = Math.abs(Math.round((c.creadoEn.getTime() - mov.fecha.getTime()) / DAY));
        const exacto = c.montoCents === cents;
        return { pagoTxId: c.id, referencia: c.referencia, metodo: c.metodo, monto: c.montoCents / 100, fecha: c.creadoEn.toISOString().slice(0, 10), confianza: exacto && dias === 0 ? 'alta' : dias <= 2 ? 'media' : 'baja' };
      }),
    };
  }

  /**
   * Bandeja de recaudos huérfanos (III.3.B): entradas bancarias sin conciliar que
   * NO tienen un recaudo (PagoTransaccion APROBADA) que las explique. Son las que
   * la contadora debe identificar/aplicar a mano.
   */
  async huerfanos(cuentaBancariaId?: string) {
    const movs = await this.prisma.movimientoBancario.findMany({
      where: { estado: 'sin_conciliar', valor: { gt: 0 }, cuentaBancariaId },
      orderBy: { fecha: 'desc' },
      take: 500,
    });
    const tol = 100;
    const out: any[] = [];
    for (const m of movs) {
      const cents = Math.round(D(m.valor) * 100);
      const match = await this.prisma.pagoTransaccion.count({ where: { estado: 'APROBADA', montoCents: { gte: cents - tol, lte: cents + tol } } });
      if (match === 0) out.push({ id: m.id, fecha: m.fecha.toISOString().slice(0, 10), descripcion: m.descripcion, referencia: m.referencia, valor: D(m.valor) });
    }
    return { total: out.length, movimientos: out };
  }

  /**
   * Confirma la conciliación de un movimiento: genera el asiento contable.
   * Para entradas: Dr <banco PUC>, Cr <contrapartida> (default 111505 pasarela).
   * Para salidas: Dr <contrapartida> (ej. gasto), Cr <banco PUC>.
   */
  async conciliar(movimientoId: string, input: { contrapartida?: string; matchPagoTxId?: string; descripcion?: string; terceroId?: string }, actor?: string) {
    const mov = await this.prisma.movimientoBancario.findUnique({ where: { id: movimientoId }, include: { cuentaBancaria: true } });
    if (!mov) throw new NotFoundException('Movimiento no encontrado.');
    if (mov.estado === 'conciliado') throw new BadRequestException('El movimiento ya está conciliado.');

    const valor = D(mov.valor);
    const bancoPuc = mov.cuentaBancaria.cuentaPuc;
    const contrapartida = input.contrapartida || (valor > 0 ? '111505' : '530505');
    const monto = Math.abs(valor);
    const desc = input.descripcion?.slice(0, 200) || `Conciliación ${mov.descripcion}`.slice(0, 200);

    const lineaBanco = valor > 0
      ? { cuenta: bancoPuc, debito: monto, descripcion: desc }
      : { cuenta: bancoPuc, credito: monto, descripcion: desc };
    const lineaContra = valor > 0
      ? { cuenta: contrapartida, credito: monto, descripcion: desc, terceroId: input.terceroId }
      : { cuenta: contrapartida, debito: monto, descripcion: desc, terceroId: input.terceroId };

    const asiento = await this.posting.post({
      evento: 'bank.movement.conciliated',
      sourceModule: 'banking',
      fecha: mov.fecha,
      tipo: 'recaudo',
      descripcion: desc,
      referencia: { tipo: 'banco', id: mov.id },
      lineas: [lineaBanco, lineaContra],
      actor,
    });

    await this.prisma.movimientoBancario.update({
      where: { id: movimientoId },
      data: { estado: 'conciliado', asientoId: asiento.id, matchPagoTxId: input.matchPagoTxId ?? null, conciliadoPor: actor, conciliadoEn: new Date() },
    });
    return { ok: true, asiento: asiento.numero, movimientoId };
  }

  async ignorar(movimientoId: string) {
    await this.prisma.movimientoBancario.update({ where: { id: movimientoId }, data: { estado: 'ignorado' } });
    return { ok: true };
  }

  async resumen(cuentaBancariaId?: string) {
    const movs = await this.prisma.movimientoBancario.findMany({ where: { cuentaBancariaId }, select: { estado: true, valor: true } });
    const sinConciliar = movs.filter((m) => m.estado === 'sin_conciliar');
    return {
      total: movs.length,
      sinConciliar: sinConciliar.length,
      conciliados: movs.filter((m) => m.estado === 'conciliado').length,
      montoSinConciliar: round2(sinConciliar.reduce((s, m) => s + D(m.valor), 0)),
    };
  }
}
