import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Analítica vertical de ISP (Fase H) + centros de costo. Cruza facturación,
 * cartera, recaudo y topología (barrio/NAP/zona/plan) para responder lo que un
 * Siigo/Helisa no puede: rentabilidad y comportamiento por geografía y red.
 * Todo deriva del ledger y del CRM (fuente de verdad), sin tablas paralelas.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Centros de costo (maestro de 1er nivel) ----

  listCentros() {
    return this.prisma.centroCosto.findMany({ orderBy: { codigo: 'asc' } });
  }

  async upsertCentro(body: { codigo: string; nombre: string; tipo?: string; padreCodigo?: string; activo?: boolean }) {
    const codigo = body.codigo?.trim().toUpperCase();
    if (!codigo) throw new BadRequestException('El código del centro de costo es obligatorio.');
    return this.prisma.centroCosto.upsert({
      where: { codigo },
      update: { nombre: body.nombre, tipo: body.tipo ?? 'operativo', padreCodigo: body.padreCodigo ?? null, activo: body.activo ?? true },
      create: { codigo, nombre: body.nombre, tipo: body.tipo ?? 'operativo', padreCodigo: body.padreCodigo ?? null, activo: body.activo ?? true },
    });
  }

  // ---- Reportes verticales ----

  /** Ingreso facturado por barrio (vía servicio → punto). */
  async ingresoPorBarrio(periodo: string) {
    const facturas = await this.prisma.factura.findMany({
      where: { periodo },
      include: { servicio: { include: { punto: { select: { barrio: true } } } } },
      take: 50000,
    });
    return this.agrupar(facturas, (f) => f.servicio.punto?.barrio ?? 'Sin barrio', (f) => D(f.total));
  }

  /** Cartera vencida por NAP (facturas vencidas/pendientes vencidas). */
  async carteraPorNap() {
    const hoy = new Date();
    const facturas = await this.prisma.factura.findMany({
      where: { estado: { in: ['pendiente', 'vencida'] }, fechaVencimiento: { lt: hoy } },
      include: { servicio: { select: { napId: true, activoNapId: true } }, pagos: { where: { estado: 'aprobado' }, select: { monto: true } } },
      take: 50000,
    });
    const map = new Map<string, { dimension: string; valor: number; cantidad: number }>();
    for (const f of facturas) {
      const nap = f.servicio.activoNapId ?? f.servicio.napId ?? 'Sin NAP';
      const pagado = f.pagos.reduce((s, p) => s + D(p.monto), 0);
      const saldo = Math.max(0, D(f.total) - pagado);
      if (saldo <= 0) continue;
      const acc = map.get(nap) ?? { dimension: nap, valor: 0, cantidad: 0 };
      acc.valor = round2(acc.valor + saldo);
      acc.cantidad += 1;
      map.set(nap, acc);
    }
    const filas = [...map.values()].sort((a, b) => b.valor - a.valor);
    return { total: round2(filas.reduce((s, f) => s + f.valor, 0)), filas };
  }

  /** Mora por plan: facturas vencidas agrupadas por plan. */
  async moraPorPlan() {
    const hoy = new Date();
    const facturas = await this.prisma.factura.findMany({
      where: { estado: { in: ['pendiente', 'vencida'] }, fechaVencimiento: { lt: hoy } },
      include: { servicio: { select: { planNombre: true } } },
      take: 50000,
    });
    return this.agrupar(facturas, (f) => f.servicio.planNombre ?? 'Sin plan', (f) => D(f.total));
  }

  /** Recaudo por canal (pasarela): PagoTransaccion aprobadas por método. */
  async recaudoPorCanal(periodo?: string) {
    const where: Prisma.PagoTransaccionWhereInput = { estado: 'APROBADA' };
    if (periodo) {
      const [y, m] = periodo.split('-').map((x) => parseInt(x, 10));
      where.actualizadoEn = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    }
    const txs = await this.prisma.pagoTransaccion.findMany({ where, take: 50000 });
    const map = new Map<string, { dimension: string; valor: number; cantidad: number }>();
    for (const t of txs) {
      const canal = t.metodo ?? 'Otro';
      const acc = map.get(canal) ?? { dimension: canal, valor: 0, cantidad: 0 };
      acc.valor = round2(acc.valor + t.montoCents / 100);
      acc.cantidad += 1;
      map.set(canal, acc);
    }
    const filas = [...map.values()].sort((a, b) => b.valor - a.valor);
    return { total: round2(filas.reduce((s, f) => s + f.valor, 0)), filas };
  }

  /** ARPU por zona (comuna): ingreso facturado del periodo / clientes activos en la zona. */
  async arpuPorZona(periodo: string) {
    const facturas = await this.prisma.factura.findMany({
      where: { periodo },
      include: { servicio: { include: { punto: { select: { comuna: true } }, cliente: { select: { id: true, estado: true } } } } },
      take: 50000,
    });
    const map = new Map<string, { zona: string; ingreso: number; clientes: Set<string> }>();
    for (const f of facturas) {
      const zona = f.servicio.punto?.comuna ?? 'Sin zona';
      const acc = map.get(zona) ?? { zona, ingreso: 0, clientes: new Set<string>() };
      acc.ingreso = round2(acc.ingreso + D(f.total));
      acc.clientes.add(f.servicio.cliente.id);
      map.set(zona, acc);
    }
    const filas = [...map.values()]
      .map((r) => ({ zona: r.zona, ingreso: r.ingreso, clientes: r.clientes.size, arpu: r.clientes.size ? round2(r.ingreso / r.clientes.size) : 0 }))
      .sort((a, b) => b.arpu - a.arpu);
    return { periodo, filas };
  }

  /** Costo de red vs ingreso por centro de costo/nodo (desde el ledger). */
  async rentabilidadPorCentro(periodo: string) {
    const movs = await this.prisma.movimientoContable.groupBy({
      by: ['centroCosto'],
      where: { asiento: { periodo, estado: 'contabilizado' }, centroCosto: { not: null } },
      _sum: { debito: true, credito: true },
    });
    // Ingreso = créditos clase 4; costo/gasto = débitos clases 5/6. Para precisión por
    // clase consultamos los movimientos con su cuenta.
    const detalle = await this.prisma.movimientoContable.findMany({
      where: { asiento: { periodo, estado: 'contabilizado' }, centroCosto: { not: null } },
      include: { cuenta: { select: { clase: true } } },
      take: 50000,
    });
    const map = new Map<string, { centro: string; ingreso: number; costo: number }>();
    for (const m of detalle) {
      const cc = m.centroCosto!;
      const acc = map.get(cc) ?? { centro: cc, ingreso: 0, costo: 0 };
      if (m.cuenta?.clase === 4) acc.ingreso = round2(acc.ingreso + D(m.credito) - D(m.debito));
      if (m.cuenta?.clase === 5 || m.cuenta?.clase === 6) acc.costo = round2(acc.costo + D(m.debito) - D(m.credito));
      map.set(cc, acc);
    }
    const centros = await this.prisma.centroCosto.findMany();
    const nombre = new Map(centros.map((c) => [c.codigo, c.nombre]));
    const filas = [...map.values()]
      .map((r) => ({ ...r, nombre: nombre.get(r.centro) ?? r.centro, margen: round2(r.ingreso - r.costo) }))
      .sort((a, b) => b.margen - a.margen);
    void movs;
    return { periodo, filas };
  }

  /** Churn por mora: clientes suspendidos/retirados vs activos. */
  async churnPorMora() {
    const grupos = await this.prisma.cliente.groupBy({ by: ['estado'], _count: { _all: true } });
    const conteo = Object.fromEntries(grupos.map((g) => [g.estado, g._count._all]));
    const activos = conteo['activo'] ?? 0;
    const suspendidos = conteo['suspendido'] ?? 0;
    const morosos = conteo['moroso'] ?? 0;
    const retirados = conteo['retirado'] ?? 0;
    const base = activos + suspendidos + morosos + retirados;
    return {
      conteo,
      tasaSuspension: base ? round2(((suspendidos + morosos) / base) * 100) : 0,
      tasaChurn: base ? round2((retirados / base) * 100) : 0,
    };
  }

  private agrupar<T>(items: T[], dimDe: (x: T) => string, valorDe: (x: T) => number) {
    const map = new Map<string, { dimension: string; valor: number; cantidad: number }>();
    for (const it of items) {
      const dim = dimDe(it);
      const acc = map.get(dim) ?? { dimension: dim, valor: 0, cantidad: 0 };
      acc.valor = round2(acc.valor + valorDe(it));
      acc.cantidad += 1;
      map.set(dim, acc);
    }
    const filas = [...map.values()].sort((a, b) => b.valor - a.valor);
    return { total: round2(filas.reduce((s, f) => s + f.valor, 0)), filas };
  }
}
