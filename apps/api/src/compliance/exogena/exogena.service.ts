import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Formatos de información exógena (DIAN) soportados, derivados del ledger. */
const FORMATOS: Record<string, { nombre: string; descripcion: string }> = {
  '1001': { nombre: 'Pagos o abonos en cuenta', descripcion: 'Gastos y costos (clases 5 y 6) por tercero.' },
  '1003': { nombre: 'Retenciones practicadas', descripcion: 'Retefuente/reteIVA/reteICA practicadas por tercero.' },
  '1005': { nombre: 'IVA descontable', descripcion: 'IVA descontable (240810) por tercero.' },
  '1006': { nombre: 'IVA generado', descripcion: 'IVA generado (240805) por tercero.' },
  '1007': { nombre: 'Ingresos recibidos', descripcion: 'Ingresos (clase 4) por tercero.' },
  '1008': { nombre: 'Cuentas por cobrar (saldo)', descripcion: 'Saldo de clientes (1305) por tercero al cierre.' },
  '1009': { nombre: 'Cuentas por pagar (saldo)', descripcion: 'Saldo de proveedores (2335) por tercero al cierre.' },
};

interface FilaExogena {
  nit: string;
  dv: string | null;
  tipoDocumento: string;
  nombre: string;
  valor: number;
}

/**
 * Generador de información exógena (medios magnéticos DIAN). Cruza los
 * movimientos contabilizados del año con los terceros, según las cuentas PUC de
 * cada formato. Es un BORRADOR que la contadora revisa y ajusta antes de
 * presentar (la clasificación fina de conceptos requiere criterio profesional).
 */
@Injectable()
export class ExogenaService {
  constructor(private readonly prisma: PrismaService) {}

  formatos() {
    return Object.entries(FORMATOS).map(([codigo, v]) => ({ codigo, ...v }));
  }

  /** Carga los movimientos del año con su cuenta, tercero y el tercero del asiento. */
  private async movimientosDelAnio(anio: number) {
    const desde = new Date(Date.UTC(anio, 0, 1));
    const hasta = new Date(Date.UTC(anio, 11, 31, 23, 59, 59));
    const asientos = await this.prisma.asientoContable.findMany({
      where: { estado: 'contabilizado', fecha: { gte: desde, lte: hasta } },
      include: { movimientos: { include: { cuenta: true, tercero: true } } },
      take: 20000,
    });
    // Para líneas sin tercero (ingreso/gasto), se hereda el tercero del asiento.
    const filas: { cuenta: string; clase: number; debito: number; credito: number; tercero: any }[] = [];
    for (const a of asientos) {
      const terceroAsiento = a.movimientos.find((m) => m.tercero)?.tercero ?? null;
      for (const m of a.movimientos) {
        filas.push({
          cuenta: m.cuentaCodigo,
          clase: m.cuenta?.clase ?? parseInt(m.cuentaCodigo[0], 10),
          debito: D(m.debito),
          credito: D(m.credito),
          tercero: m.tercero ?? terceroAsiento,
        });
      }
    }
    return filas;
  }

  /** Agrupa por tercero sumando un valor calculado por línea. */
  private agrupar(filas: { tercero: any }[], valorDe: (f: any) => number): { filas: FilaExogena[]; total: number } {
    const map = new Map<string, FilaExogena>();
    let total = 0;
    for (const f of filas) {
      const v = round2(valorDe(f));
      if (v === 0 || !f.tercero) continue;
      const t = f.tercero;
      const key = t.documento;
      const acc = map.get(key) ?? { nit: t.documento, dv: t.dv ?? null, tipoDocumento: t.tipoDocumento ?? 'CC', nombre: t.nombre, valor: 0 };
      acc.valor = round2(acc.valor + v);
      map.set(key, acc);
      total = round2(total + v);
    }
    const out = [...map.values()].filter((r) => Math.abs(r.valor) > 0).sort((a, b) => b.valor - a.valor);
    return { filas: out, total };
  }

  async generar(formato: string, anio: number) {
    if (!FORMATOS[formato]) throw new BadRequestException(`Formato ${formato} no soportado.`);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw new BadRequestException('Año inválido.');
    const movs = await this.movimientosDelAnio(anio);

    let resultado: { filas: FilaExogena[]; total: number };
    switch (formato) {
      case '1001': // pagos/abonos: débitos de gastos (5) y costos (6)
        resultado = this.agrupar(movs.filter((m) => m.clase === 5 || m.clase === 6), (m) => m.debito);
        break;
      case '1003': // retenciones practicadas: créditos de 2365/2367/2368
        resultado = this.agrupar(movs.filter((m) => /^(2365|2367|2368)/.test(m.cuenta)), (m) => m.credito);
        break;
      case '1005': // IVA descontable: débitos 240810
        resultado = this.agrupar(movs.filter((m) => m.cuenta.startsWith('240810')), (m) => m.debito);
        break;
      case '1006': // IVA generado: créditos 240805
        resultado = this.agrupar(movs.filter((m) => m.cuenta.startsWith('240805')), (m) => m.credito);
        break;
      case '1007': // ingresos: créditos clase 4
        resultado = this.agrupar(movs.filter((m) => m.clase === 4), (m) => m.credito);
        break;
      case '1008': // CxC saldo: 1305 (débito - crédito)
        resultado = this.agrupar(movs.filter((m) => m.cuenta.startsWith('1305')), (m) => m.debito - m.credito);
        break;
      case '1009': // CxP saldo: 2335 (crédito - débito)
        resultado = this.agrupar(movs.filter((m) => m.cuenta.startsWith('2335')), (m) => m.credito - m.debito);
        break;
      default:
        resultado = { filas: [], total: 0 };
    }
    return { formato, nombre: FORMATOS[formato].nombre, anio, terceros: resultado.filas.length, total: resultado.total, filas: resultado.filas };
  }

  async csv(formato: string, anio: number): Promise<string> {
    const r = await this.generar(formato, anio);
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [
      ['Tipo documento', 'NIT/Documento', 'DV', 'Nombre/Razón social', 'Valor'],
      ...r.filas.map((f) => [f.tipoDocumento, f.nit, f.dv ?? '', f.nombre, f.valor]),
      ['', '', '', 'TOTAL', r.total],
    ];
    return '\uFEFF' + rows.map((row) => row.map((c) => esc(c)).join(';')).join('\n');
  }
}
