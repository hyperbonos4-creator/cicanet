import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

/** Buckets de antigüedad de cartera (días de vencimiento). */
type Bucket = 'porVencer' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90mas';
const BUCKETS: Bucket[] = ['porVencer', 'd1_30', 'd31_60', 'd61_90', 'd90mas'];
const cero = (): Record<Bucket, number> => ({ porVencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90mas: 0 });

function bucketDe(diasVencido: number): Bucket {
  if (diasVencido <= 0) return 'porVencer';
  if (diasVencido <= 30) return 'd1_30';
  if (diasVencido <= 60) return 'd31_60';
  if (diasVencido <= 90) return 'd61_90';
  return 'd90mas';
}

interface FacturaCartera {
  id: string;
  periodo: string;
  total: number;
  pagado: number;
  saldo: number;
  fechaVencimiento: string;
  diasVencido: number;
  bucket: Bucket;
  cliente: { id: string; codigo: string; nombre: string; estado: string; telefono: string | null; email: string | null };
  ubicacion: { barrio: string | null; comuna: string | null; nap: string | null };
}

/**
 * Cartera y aging de cuentas por cobrar. Se calcula sobre las facturas no
 * pagadas (saldo = total − pagos aprobados), clasificando por días de
 * vencimiento. Permite verlo por cliente y agregado por barrio/comuna/NAP
 * (la "cartera georreferenciada" que diferencia a CICANET de un contable genérico).
 */
@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Carga las facturas con saldo pendiente y las normaliza para el aging. */
  private async facturasPendientes(): Promise<FacturaCartera[]> {
    const facturas = await this.prisma.factura.findMany({
      where: { estado: { in: ['pendiente', 'vencida'] } },
      include: {
        pagos: { where: { estado: 'aprobado' }, select: { monto: true } },
        servicio: {
          select: {
            napId: true,
            activoNapId: true,
            cliente: { select: { id: true, codigo: true, nombre: true, estado: true, telefonoMovil: true, email: true } },
            punto: { select: { barrio: true, comuna: true } },
          },
        },
      },
      take: 5000,
    });

    const hoy = Date.now();
    const out: FacturaCartera[] = [];
    for (const f of facturas) {
      const pagado = round2(f.pagos.reduce((s, p) => s + D(p.monto), 0));
      const saldo = round2(D(f.total) - pagado);
      if (saldo <= 0) continue;
      const venc = f.fechaVencimiento.getTime();
      const diasVencido = Math.floor((hoy - venc) / DAY);
      const c = f.servicio.cliente;
      out.push({
        id: f.id,
        periodo: f.periodo,
        total: round2(D(f.total)),
        pagado,
        saldo,
        fechaVencimiento: f.fechaVencimiento.toISOString().slice(0, 10),
        diasVencido,
        bucket: bucketDe(diasVencido),
        cliente: { id: c.id, codigo: c.codigo, nombre: c.nombre, estado: c.estado, telefono: c.telefonoMovil, email: c.email },
        ubicacion: { barrio: f.servicio.punto?.barrio ?? null, comuna: f.servicio.punto?.comuna ?? null, nap: f.servicio.activoNapId ?? f.servicio.napId ?? null },
      });
    }
    return out;
  }

  /** Aging por cliente + resumen de buckets. */
  async aging(filtro: { barrio?: string; nap?: string; soloVencidos?: boolean } = {}) {
    let facturas = await this.facturasPendientes();
    if (filtro.barrio) facturas = facturas.filter((f) => f.ubicacion.barrio === filtro.barrio);
    if (filtro.nap) facturas = facturas.filter((f) => f.ubicacion.nap === filtro.nap);
    if (filtro.soloVencidos) facturas = facturas.filter((f) => f.diasVencido > 0);

    const porCliente = new Map<string, { cliente: FacturaCartera['cliente']; ubicacion: FacturaCartera['ubicacion']; buckets: Record<Bucket, number>; total: number; facturas: number; maxDias: number }>();
    const resumen = cero();
    let totalCartera = 0;
    let totalVencido = 0;

    for (const f of facturas) {
      resumen[f.bucket] = round2(resumen[f.bucket] + f.saldo);
      totalCartera = round2(totalCartera + f.saldo);
      if (f.diasVencido > 0) totalVencido = round2(totalVencido + f.saldo);

      const key = f.cliente.id;
      const acc = porCliente.get(key) ?? { cliente: f.cliente, ubicacion: f.ubicacion, buckets: cero(), total: 0, facturas: 0, maxDias: 0 };
      acc.buckets[f.bucket] = round2(acc.buckets[f.bucket] + f.saldo);
      acc.total = round2(acc.total + f.saldo);
      acc.facturas += 1;
      acc.maxDias = Math.max(acc.maxDias, f.diasVencido);
      porCliente.set(key, acc);
    }

    const clientes = [...porCliente.values()].sort((a, b) => b.maxDias - a.maxDias || b.total - a.total);
    return {
      generadoEn: new Date().toISOString(),
      resumen,
      totalCartera,
      totalVencido,
      clientesConDeuda: clientes.length,
      clientes,
    };
  }

  /** Aging agregado por dimensión geográfica/red: barrio | comuna | nap. */
  async agingPorDimension(dim: 'barrio' | 'comuna' | 'nap') {
    const facturas = await this.facturasPendientes();
    const grupos = new Map<string, { buckets: Record<Bucket, number>; total: number; vencido: number; clientes: Set<string> }>();
    for (const f of facturas) {
      const key = (dim === 'barrio' ? f.ubicacion.barrio : dim === 'comuna' ? f.ubicacion.comuna : f.ubicacion.nap) || 'Sin asignar';
      const acc = grupos.get(key) ?? { buckets: cero(), total: 0, vencido: 0, clientes: new Set<string>() };
      acc.buckets[f.bucket] = round2(acc.buckets[f.bucket] + f.saldo);
      acc.total = round2(acc.total + f.saldo);
      if (f.diasVencido > 0) acc.vencido = round2(acc.vencido + f.saldo);
      acc.clientes.add(f.cliente.id);
      grupos.set(key, acc);
    }
    return {
      dimension: dim,
      grupos: [...grupos.entries()]
        .map(([nombre, g]) => ({ nombre, total: g.total, vencido: g.vencido, clientes: g.clientes.size, buckets: g.buckets }))
        .sort((a, b) => b.vencido - a.vencido || b.total - a.total),
    };
  }

  /** Detalle de cartera de un cliente (facturas con saldo y días de vencimiento). */
  async carteraCliente(clienteId: string) {
    const facturas = (await this.facturasPendientes()).filter((f) => f.cliente.id === clienteId);
    const total = round2(facturas.reduce((s, f) => s + f.saldo, 0));
    const vencido = round2(facturas.filter((f) => f.diasVencido > 0).reduce((s, f) => s + f.saldo, 0));
    return {
      clienteId,
      total,
      vencido,
      facturas: facturas.sort((a, b) => b.diasVencido - a.diasVencido),
    };
  }

  /** KPIs rápidos para el dashboard contable / dunning. */
  async resumen() {
    const a = await this.aging();
    return {
      totalCartera: a.totalCartera,
      totalVencido: a.totalVencido,
      clientesConDeuda: a.clientesConDeuda,
      buckets: a.resumen,
    };
  }
}
