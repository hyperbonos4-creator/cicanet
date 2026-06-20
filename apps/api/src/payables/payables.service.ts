import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LineaCompra {
  cuenta: string;       // PUC de gasto/activo (5xxx, 1xxx)
  descripcion?: string;
  base: number;         // valor antes de IVA
  ivaPct?: number;      // 0 | 5 | 19
}

export interface CrearCompraInput {
  proveedor: { documento: string; nombre: string; tipoDocumento?: string; dv?: string };
  numeroProveedor?: string;
  fecha?: string;
  fechaVencimiento?: string;
  concepto: string;
  lineas: LineaCompra[];
  retefuente?: number;
  reteIva?: number;
  reteIca?: number;
  documentoSoporte?: boolean;
  creadoPor?: string;
}

/** Cuentas PUC fijas usadas por la causación de compras. */
const CUENTAS = {
  ivaDescontable: '240810',
  cxp: '233525',
  retefuente: '236540',
  reteIva: '236701',
  reteIca: '236801',
};

/**
 * Cuentas por pagar: causación de facturas de compra/gasto con IVA descontable y
 * retenciones practicadas, y su pago. Cada operación genera un asiento balanceado.
 *   Causación:  Dr gasto/activo + Dr IVA desc.  Cr CxP + Cr retenciones.
 *   Pago:       Dr CxP  Cr banco/caja.
 */
@Injectable()
export class PayablesService {
  private readonly logger = new Logger('PayablesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  private async siguienteNumero(): Promise<string> {
    const n = await this.prisma.facturaCompra.count();
    return `CXP-${String(n + 1).padStart(6, '0')}`;
  }

  list(filtro: { estado?: string; proveedorId?: string } = {}) {
    return this.prisma.facturaCompra.findMany({
      where: { estado: filtro.estado, proveedorId: filtro.proveedorId },
      orderBy: { creadoEn: 'desc' },
      take: 300,
    });
  }

  async getOne(id: string) {
    const f = await this.prisma.facturaCompra.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Factura de compra no encontrada.');
    return f;
  }

  async resumen() {
    const filas = await this.prisma.facturaCompra.findMany({ where: { estado: 'pendiente' }, select: { totalAPagar: true, fechaVencimiento: true } });
    const hoy = Date.now();
    let total = 0, vencido = 0;
    for (const f of filas) {
      const v = D(f.totalAPagar);
      total = round2(total + v);
      if (f.fechaVencimiento.getTime() < hoy) vencido = round2(vencido + v);
    }
    return { totalPorPagar: total, vencido, facturasPendientes: filas.length };
  }

  /** Causa una factura de compra y la contabiliza. */
  async crear(input: CrearCompraInput) {
    if (!input.lineas?.length) throw new BadRequestException('La compra requiere al menos una línea.');
    if (!input.concepto?.trim()) throw new BadRequestException('El concepto es obligatorio.');

    // Totales.
    let subtotal = 0;
    let ivaDescontable = 0;
    for (const l of input.lineas) {
      const base = round2(D(l.base));
      if (base <= 0) throw new BadRequestException('Cada línea debe tener una base mayor a cero.');
      subtotal = round2(subtotal + base);
      ivaDescontable = round2(ivaDescontable + base * (D(l.ivaPct) / 100));
    }
    const retefuente = round2(D(input.retefuente));
    const reteIva = round2(D(input.reteIva));
    const reteIca = round2(D(input.reteIca));
    const totalAPagar = round2(subtotal + ivaDescontable - retefuente - reteIva - reteIca);
    if (totalAPagar < 0) throw new BadRequestException('Las retenciones no pueden superar el valor de la factura.');

    const proveedor = await this.accounting.crearTercero({
      documento: input.proveedor.documento,
      nombre: input.proveedor.nombre,
      tipo: 'proveedor',
      tipoDocumento: input.proveedor.tipoDocumento,
      dv: input.proveedor.dv,
    });

    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const fechaVencimiento = input.fechaVencimiento ? new Date(input.fechaVencimiento) : fecha;
    const numero = await this.siguienteNumero();

    // Asiento de causación.
    const lineasAsiento: any[] = input.lineas.map((l) => ({
      cuenta: l.cuenta,
      debito: round2(D(l.base)),
      descripcion: l.descripcion || input.concepto,
    }));
    if (ivaDescontable > 0) lineasAsiento.push({ cuenta: CUENTAS.ivaDescontable, debito: ivaDescontable, descripcion: 'IVA descontable' });
    lineasAsiento.push({ cuenta: CUENTAS.cxp, credito: totalAPagar, terceroId: proveedor.id, descripcion: `CxP ${numero}` });
    if (retefuente > 0) lineasAsiento.push({ cuenta: CUENTAS.retefuente, credito: retefuente, descripcion: 'Retención en la fuente' });
    if (reteIva > 0) lineasAsiento.push({ cuenta: CUENTAS.reteIva, credito: reteIva, descripcion: 'ReteIVA' });
    if (reteIca > 0) lineasAsiento.push({ cuenta: CUENTAS.reteIca, credito: reteIca, descripcion: 'ReteICA' });

    const asiento = await this.accounting.crearAsiento({
      fecha,
      tipo: 'compra',
      descripcion: `Compra ${numero} - ${input.proveedor.nombre}: ${input.concepto}`,
      referenciaTipo: 'compra',
      referenciaId: numero,
      lineas: lineasAsiento,
      contabilizar: true,
      creadoPor: input.creadoPor,
    });

    return this.prisma.facturaCompra.create({
      data: {
        numero,
        numeroProveedor: input.numeroProveedor ?? null,
        proveedorId: proveedor.id,
        proveedorNombre: input.proveedor.nombre,
        fecha,
        fechaVencimiento,
        concepto: input.concepto.slice(0, 300),
        lineas: input.lineas as any,
        subtotal,
        ivaDescontable,
        retefuente,
        reteIva,
        reteIca,
        totalAPagar,
        estado: 'pendiente',
        asientoId: asiento.id,
        documentoSoporte: !!input.documentoSoporte,
        creadoPor: input.creadoPor ?? null,
      },
    });
  }

  /** Registra el pago de una factura de compra. */
  async pagar(id: string, input: { cuentaBanco?: string; fecha?: string }, actor?: string) {
    const f = await this.getOne(id);
    if (f.estado !== 'pendiente') throw new BadRequestException('La factura no está pendiente de pago.');
    const cuentaBanco = input.cuentaBanco || '111005';
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const total = D(f.totalAPagar);

    const asiento = await this.accounting.crearAsiento({
      fecha,
      tipo: 'gasto',
      descripcion: `Pago compra ${f.numero} - ${f.proveedorNombre}`,
      referenciaTipo: 'pago_compra',
      referenciaId: f.numero,
      lineas: [
        { cuenta: CUENTAS.cxp, debito: total, terceroId: f.proveedorId, descripcion: `Pago CxP ${f.numero}` },
        { cuenta: cuentaBanco, credito: total, descripcion: `Pago ${f.numero}` },
      ],
      contabilizar: true,
      creadoPor: actor,
    });

    return this.prisma.facturaCompra.update({
      where: { id },
      data: { estado: 'pagada', asientoPagoId: asiento.id, pagadaEn: new Date() },
    });
  }
}
