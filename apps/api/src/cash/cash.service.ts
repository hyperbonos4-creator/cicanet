import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService } from '../accounting/posting-engine.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.5; // tolerancia de redondeo en pesos

const CUENTAS = {
  cxc: '130505',
  anticipo: '280505',       // saldo a favor del cliente identificado
  porIdentificar: '280515', // recaudos sin cliente
};
const MEDIOS = ['efectivo', 'transferencia', 'wompi', 'nequi', 'consignacion', 'tarjeta'];

export interface AplicacionInput { facturaId: string; monto: number; }
export interface CrearReciboInput {
  clienteId?: string;
  medioPago: string;
  cuentaDestino?: string;
  referencia?: string;
  montoRecibido: number;
  fecha?: string;
  origen?: string;
  aplicaciones?: AplicacionInput[];
  creadoPor?: string;
}

/**
 * Cash application — Recibo de caja y aplicación de pagos. Núcleo del recaudo:
 *  - Abono parcial, pago de múltiples facturas, anticipos (saldo a favor),
 *    recaudos por identificar (sin cliente) y reversión.
 *  - Contabiliza el recaudo (Dr banco/caja; Cr CxC aplicado + Cr anticipo/por
 *    identificar el saldo). La aplicación crea `Pago` por factura → el aging se
 *    actualiza solo (collections resta pagos aprobados).
 *  - El ledger es la fuente de verdad: CxC por tercero == facturas pendientes.
 */
@Injectable()
export class CashService implements OnModuleInit {
  private readonly logger = new Logger('CashService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingEngineService,
  ) {}

  async onModuleInit() {
    const existe = await this.prisma.cuentaContable.findUnique({ where: { codigo: CUENTAS.porIdentificar } });
    if (!existe) {
      try { await this.accounting.crearCuenta({ codigo: CUENTAS.porIdentificar, nombre: 'Recaudos por identificar', imputable: true, exigeTercero: false }); } catch { /* carrera */ }
    }
  }

  // ---- saldo pendiente de una factura ----
  private async saldoFactura(facturaId: string): Promise<{ factura: any; saldo: number }> {
    const factura = await this.prisma.factura.findUnique({ where: { id: facturaId }, include: { pagos: { where: { estado: 'aprobado' }, select: { monto: true } } } });
    if (!factura) throw new NotFoundException(`Factura ${facturaId} no encontrada.`);
    const pagado = round2(factura.pagos.reduce((s, p) => s + D(p.monto), 0));
    return { factura, saldo: round2(D(factura.total) - pagado) };
  }

  private async siguienteNumero(): Promise<string> {
    const n = await this.prisma.reciboCaja.count();
    return `REC-${String(n + 1).padStart(6, '0')}`;
  }

  // ---- crear recibo (con aplicaciones opcionales) ----
  async crear(input: CrearReciboInput) {
    if (!MEDIOS.includes(input.medioPago)) throw new BadRequestException(`Medio de pago inválido. Usa: ${MEDIOS.join(', ')}`);
    const monto = round2(D(input.montoRecibido));
    if (monto <= 0) throw new BadRequestException('El monto recibido debe ser mayor a cero.');
    const cuentaDestino = input.cuentaDestino || (input.medioPago === 'efectivo' ? '110505' : '111505');
    const fecha = input.fecha ? new Date(input.fecha) : new Date();

    // Resolver cliente (opcional).
    let cliente: any = null;
    if (input.clienteId) {
      cliente = await this.prisma.cliente.findUnique({ where: { id: input.clienteId } });
      if (!cliente) throw new BadRequestException('Cliente no encontrado.');
    }

    // Validar aplicaciones.
    const aplicaciones = input.aplicaciones ?? [];
    let aplicado = 0;
    const detalle: { facturaId: string; monto: number; factura: any }[] = [];
    for (const ap of aplicaciones) {
      const m = round2(D(ap.monto));
      if (m <= 0) throw new BadRequestException('Cada aplicación debe ser mayor a cero.');
      const { factura, saldo } = await this.saldoFactura(ap.facturaId);
      if (cliente && factura.servicioId) {
        const serv = await this.prisma.servicio.findUnique({ where: { id: factura.servicioId }, select: { clienteId: true } });
        if (serv && serv.clienteId !== cliente.id) throw new BadRequestException('Una factura no corresponde al cliente del recibo.');
      }
      if (m > saldo + EPS) throw new BadRequestException(`La aplicación (${m}) supera el saldo de la factura (${saldo}).`);
      aplicado = round2(aplicado + m);
      detalle.push({ facturaId: ap.facturaId, monto: m, factura });
    }
    if (aplicado > monto + EPS) throw new BadRequestException('La suma aplicada supera el monto recibido.');
    const saldoPorAplicar = round2(monto - aplicado);

    const numero = await this.siguienteNumero();
    const cuentaSaldo = saldoPorAplicar > 0 ? (cliente ? CUENTAS.anticipo : CUENTAS.porIdentificar) : null;

    // Asiento de recaudo (Dr banco/caja; Cr CxC aplicado + Cr saldo).
    const lineas: any[] = [{ cuenta: cuentaDestino, debito: monto, descripcion: `Recaudo ${numero}` }];
    let terceroId: string | undefined;
    if (cliente) {
      const tercero = await this.accounting.crearTercero({ documento: cliente.documento, nombre: cliente.nombre, tipo: 'cliente', clienteId: cliente.id });
      terceroId = tercero.id;
      if (aplicado > 0) lineas.push({ cuenta: CUENTAS.cxc, credito: aplicado, terceroId, descripcion: `Abono CxC ${cliente.nombre}` });
      if (saldoPorAplicar > 0) lineas.push({ cuenta: CUENTAS.anticipo, credito: saldoPorAplicar, terceroId, descripcion: `Anticipo ${cliente.nombre}` });
    } else {
      lineas.push({ cuenta: CUENTAS.porIdentificar, credito: monto, descripcion: 'Recaudo por identificar' });
    }
    const asiento = await this.posting.post({
      evento: 'payment.received',
      sourceModule: 'cash',
      fecha, tipo: 'recaudo',
      descripcion: `Recibo de caja ${numero}${cliente ? ' - ' + cliente.nombre : ' (por identificar)'}`,
      referencia: { tipo: 'recibo_caja', id: numero },
      trazas: { clienteId: cliente?.id ?? undefined },
      lineas, actor: input.creadoPor,
    });

    // Persistir recibo.
    const recibo = await this.prisma.reciboCaja.create({
      data: {
        numero, fecha,
        clienteId: cliente?.id ?? null, clienteNombre: cliente?.nombre ?? null,
        medioPago: input.medioPago, cuentaDestino, referencia: input.referencia ?? null,
        montoRecibido: monto, montoAplicado: aplicado, saldoPorAplicar, cuentaSaldo,
        estado: aplicado === 0 ? 'sin_aplicar' : saldoPorAplicar > 0 ? 'parcial' : 'aplicado',
        origen: input.origen ?? 'manual', asientoId: asiento.id, creadoPor: input.creadoPor ?? null,
      },
    });

    // Registrar aplicaciones (Pago por factura) y marcar facturas pagadas.
    for (const d of detalle) await this.registrarAplicacion(recibo.id, d.facturaId, d.monto, input.medioPago, numero, null);

    return this.getOne(recibo.id);
  }

  /** Crea el Pago, la AplicacionPago y actualiza el estado de la factura. */
  private async registrarAplicacion(reciboId: string, facturaId: string, monto: number, metodo: string, numero: string, asientoId: string | null) {
    await this.prisma.pago.create({ data: { facturaId, monto, metodo, estado: 'aprobado', pagadoEn: new Date() } });
    await this.prisma.aplicacionPago.create({ data: { reciboId, facturaId, monto, asientoId } });
    const { saldo } = await this.saldoFactura(facturaId);
    if (saldo <= EPS) await this.prisma.factura.update({ where: { id: facturaId }, data: { estado: 'pagada' } });
  }

  /** Aplica el saldo pendiente de un recibo a más facturas (reclasifica el anticipo). */
  async aplicarSaldo(reciboId: string, aplicaciones: AplicacionInput[], actor?: string) {
    const recibo = await this.prisma.reciboCaja.findUnique({ where: { id: reciboId } });
    if (!recibo) throw new NotFoundException('Recibo no encontrado.');
    if (recibo.estado === 'anulado') throw new BadRequestException('El recibo está anulado.');
    if (!recibo.clienteId) throw new BadRequestException('Recibo sin cliente: primero identifícalo.');
    let saldo = D(recibo.saldoPorAplicar);
    const cuentaSaldo = recibo.cuentaSaldo || CUENTAS.anticipo;

    const tercero = await this.accounting.crearTercero({
      documento: (await this.prisma.cliente.findUnique({ where: { id: recibo.clienteId } }))!.documento,
      nombre: recibo.clienteNombre || 'Cliente', tipo: 'cliente', clienteId: recibo.clienteId,
    });

    let aplicadoAhora = 0;
    for (const ap of aplicaciones) {
      const m = round2(D(ap.monto));
      if (m <= 0) continue;
      if (m > saldo + EPS) throw new BadRequestException('La aplicación supera el saldo del recibo.');
      const { saldo: saldoFac } = await this.saldoFactura(ap.facturaId);
      if (m > saldoFac + EPS) throw new BadRequestException('La aplicación supera el saldo de la factura.');
      // Reclasificación: Dr anticipo/por-identificar ; Cr CxC (tercero).
      const asiento = await this.posting.post({
        evento: 'payment.applied',
        sourceModule: 'cash',
        fecha: new Date(), tipo: 'recaudo',
        descripcion: `Aplicación recibo ${recibo.numero}`,
        referencia: { tipo: 'recibo_caja', id: recibo.numero },
        trazas: { clienteId: recibo.clienteId ?? undefined },
        lineas: [
          { cuenta: cuentaSaldo, debito: m, terceroId: tercero.id, descripcion: 'Aplicación de anticipo' },
          { cuenta: CUENTAS.cxc, credito: m, terceroId: tercero.id, descripcion: 'Abono CxC' },
        ],
        actor,
      });
      await this.registrarAplicacion(reciboId, ap.facturaId, m, recibo.medioPago, recibo.numero, asiento.id);
      saldo = round2(saldo - m);
      aplicadoAhora = round2(aplicadoAhora + m);
    }

    const nuevoAplicado = round2(D(recibo.montoAplicado) + aplicadoAhora);
    await this.prisma.reciboCaja.update({
      where: { id: reciboId },
      data: { montoAplicado: nuevoAplicado, saldoPorAplicar: saldo, estado: saldo <= EPS ? 'aplicado' : 'parcial' },
    });
    return this.getOne(reciboId);
  }

  /** Identifica un recibo huérfano (asigna cliente) y opcionalmente aplica. */
  async identificar(reciboId: string, clienteId: string, aplicaciones: AplicacionInput[] = [], actor?: string) {
    const recibo = await this.prisma.reciboCaja.findUnique({ where: { id: reciboId } });
    if (!recibo) throw new NotFoundException('Recibo no encontrado.');
    if (recibo.clienteId) throw new BadRequestException('El recibo ya tiene cliente.');
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) throw new BadRequestException('Cliente no encontrado.');
    await this.prisma.reciboCaja.update({ where: { id: reciboId }, data: { clienteId, clienteNombre: cliente.nombre } });
    if (aplicaciones.length) return this.aplicarSaldo(reciboId, aplicaciones, actor);
    return this.getOne(reciboId);
  }

  /** Anula un recibo: reversa el asiento, elimina pagos/aplicaciones y reabre facturas. */
  async anular(reciboId: string, actor?: string) {
    const recibo = await this.prisma.reciboCaja.findUnique({ where: { id: reciboId }, include: { aplicaciones: true } });
    if (!recibo) throw new NotFoundException('Recibo no encontrado.');
    if (recibo.estado === 'anulado') throw new BadRequestException('El recibo ya está anulado.');

    // Reversar asientos (creación + aplicaciones posteriores).
    const asientoIds = [recibo.asientoId, ...recibo.aplicaciones.map((a) => a.asientoId)].filter(Boolean) as string[];
    for (const id of [...new Set(asientoIds)]) {
      try { await this.accounting.reversar(id, actor); } catch (e: any) { this.logger.warn(`No se reversó ${id}: ${e.message}`); }
    }
    // Eliminar pagos generados y reabrir facturas.
    for (const ap of recibo.aplicaciones) {
      const { factura } = await this.saldoFactura(ap.facturaId).catch(() => ({ factura: null }));
      // Borra un pago aprobado equivalente de esa factura.
      const pago = await this.prisma.pago.findFirst({ where: { facturaId: ap.facturaId, monto: ap.monto, estado: 'aprobado' } });
      if (pago) await this.prisma.pago.delete({ where: { id: pago.id } });
      if (factura && factura.estado === 'pagada') await this.prisma.factura.update({ where: { id: ap.facturaId }, data: { estado: 'pendiente' } });
    }
    await this.prisma.aplicacionPago.deleteMany({ where: { reciboId } });
    await this.prisma.reciboCaja.update({ where: { id: reciboId }, data: { estado: 'anulado', montoAplicado: 0, saldoPorAplicar: 0 } });
    return { ok: true };
  }

  // ---- lecturas ----
  list(filtro: { estado?: string; clienteId?: string } = {}) {
    return this.prisma.reciboCaja.findMany({ where: { estado: filtro.estado, clienteId: filtro.clienteId }, orderBy: { creadoEn: 'desc' }, take: 300 });
  }
  async getOne(id: string) {
    const r = await this.prisma.reciboCaja.findUnique({ where: { id }, include: { aplicaciones: true } });
    if (!r) throw new NotFoundException('Recibo no encontrado.');
    return r;
  }
  async resumen() {
    const recibos = await this.prisma.reciboCaja.findMany({ where: { estado: { in: ['sin_aplicar', 'parcial'] } }, select: { saldoPorAplicar: true, clienteId: true } });
    const porAplicar = round2(recibos.reduce((s, r) => s + D(r.saldoPorAplicar), 0));
    const huerfanos = recibos.filter((r) => !r.clienteId).length;
    return { recibosPendientes: recibos.length, totalPorAplicar: porAplicar, huerfanos };
  }

  /** Facturas pendientes de un cliente (para la pantalla de aplicación). */
  async facturasPendientes(clienteId: string) {
    const servicios = await this.prisma.servicio.findMany({ where: { clienteId }, select: { id: true } });
    const ids = servicios.map((s) => s.id);
    if (!ids.length) return [];
    const facturas = await this.prisma.factura.findMany({ where: { servicioId: { in: ids }, estado: { in: ['pendiente', 'vencida'] } }, include: { pagos: { where: { estado: 'aprobado' }, select: { monto: true } } }, orderBy: { fechaVencimiento: 'asc' } });
    return facturas.map((f) => {
      const pagado = round2(f.pagos.reduce((s, p) => s + D(p.monto), 0));
      return { id: f.id, periodo: f.periodo, total: D(f.total), saldo: round2(D(f.total) - pagado), fechaVencimiento: f.fechaVencimiento.toISOString().slice(0, 10) };
    }).filter((f) => f.saldo > EPS);
  }
}
