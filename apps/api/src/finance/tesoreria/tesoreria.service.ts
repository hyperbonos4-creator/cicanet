import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService } from '../accounting/posting-engine.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export interface EgresoInput { cuentaBanco: string; cuentaGasto: string; monto: number; concepto: string; beneficiario?: string; fecha?: string; }
export interface TrasladoInput { cuentaOrigen: string; cuentaDestino: string; monto: number; concepto?: string; fecha?: string; }
export interface ComisionInput { cuentaBanco: string; monto: number; concepto?: string; cuentaGasto?: string; fecha?: string; }
export interface AnticipoInput { cuentaBanco: string; monto: number; beneficiario: string; concepto?: string; fecha?: string; }
export interface LegalizarInput { cuentaGasto: string; monto: number; concepto?: string; beneficiario?: string; fecha?: string; }

const CUENTA_ANTICIPO = '133005'; // Anticipos y avances a proveedores

/**
 * Tesorería: egresos directos, traslados entre cuentas/cajas y comisiones
 * bancarias/GMF. Cada operación genera su asiento. Además: saldos del disponible
 * (11xx) derivados del ledger, arqueo y flujo de caja proyectado.
 */
@Injectable()
export class TesoreriaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingEngineService,
  ) {}

  private async siguienteNumero(): Promise<string> {
    const n = await this.prisma.movimientoTesoreria.count();
    return `TES-${String(n + 1).padStart(6, '0')}`;
  }

  private validarDisponible(cuenta: string) {
    if (!/^11\d{2,}$/.test(cuenta)) throw new BadRequestException(`La cuenta ${cuenta} debe ser del disponible (11xx).`);
  }

  /** Egreso: Dr gasto/destino, Cr banco/caja. */
  async egreso(input: EgresoInput, actor?: string) {
    const monto = round2(D(input.monto));
    if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a cero.');
    this.validarDisponible(input.cuentaBanco);
    if (!input.concepto?.trim()) throw new BadRequestException('El concepto es obligatorio.');
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const asiento = await this.posting.post({
      evento: 'treasury.movement', sourceModule: 'tesoreria',
      fecha, tipo: 'gasto',
      descripcion: `Egreso: ${input.concepto}${input.beneficiario ? ' - ' + input.beneficiario : ''}`,
      referencia: { tipo: 'tesoreria' }, lineas: [
        { cuenta: input.cuentaGasto, debito: monto, descripcion: input.concepto },
        { cuenta: input.cuentaBanco, credito: monto, descripcion: input.concepto },
      ], actor,
    });
    return this.persistir('egreso', { fecha, monto, concepto: input.concepto, beneficiario: input.beneficiario, cuentaOrigen: input.cuentaBanco, contraCuenta: input.cuentaGasto, asientoId: asiento.id, creadoPor: actor });
  }

  /** Traslado entre cuentas: Dr destino, Cr origen. */
  async traslado(input: TrasladoInput, actor?: string) {
    const monto = round2(D(input.monto));
    if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a cero.');
    this.validarDisponible(input.cuentaOrigen);
    this.validarDisponible(input.cuentaDestino);
    if (input.cuentaOrigen === input.cuentaDestino) throw new BadRequestException('Las cuentas de origen y destino deben ser distintas.');
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const concepto = input.concepto?.trim() || `Traslado ${input.cuentaOrigen} → ${input.cuentaDestino}`;
    const asiento = await this.posting.post({
      evento: 'treasury.movement', sourceModule: 'tesoreria',
      fecha, tipo: 'gasto', descripcion: concepto, referencia: { tipo: 'tesoreria' },
      lineas: [
        { cuenta: input.cuentaDestino, debito: monto, descripcion: concepto },
        { cuenta: input.cuentaOrigen, credito: monto, descripcion: concepto },
      ], actor,
    });
    return this.persistir('traslado', { fecha, monto, concepto, cuentaOrigen: input.cuentaOrigen, cuentaDestino: input.cuentaDestino, asientoId: asiento.id, creadoPor: actor });
  }

  /** Comisión bancaria / GMF: Dr gasto financiero, Cr banco. */
  async comision(input: ComisionInput, actor?: string) {
    const monto = round2(D(input.monto));
    if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a cero.');
    this.validarDisponible(input.cuentaBanco);
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const concepto = input.concepto?.trim() || 'Comisión bancaria';
    const cuentaGasto = input.cuentaGasto || '530505';
    const asiento = await this.posting.post({
      evento: 'treasury.movement', sourceModule: 'tesoreria',
      fecha, tipo: 'gasto', descripcion: concepto, referencia: { tipo: 'tesoreria' },
      lineas: [
        { cuenta: cuentaGasto, debito: monto, descripcion: concepto },
        { cuenta: input.cuentaBanco, credito: monto, descripcion: concepto },
      ], actor,
    });
    return this.persistir('comision', { fecha, monto, concepto, cuentaOrigen: input.cuentaBanco, contraCuenta: cuentaGasto, asientoId: asiento.id, creadoPor: actor });
  }

  private async persistir(tipo: string, data: any) {
    const numero = await this.siguienteNumero();
    return this.prisma.movimientoTesoreria.create({ data: { numero, tipo, ...data } });
  }

  private async asegurarCuenta(codigo: string, nombre: string) {
    const existe = await this.prisma.cuentaContable.findUnique({ where: { codigo } });
    if (!existe) { try { await this.accounting.crearCuenta({ codigo, nombre, imputable: true }); } catch { /* carrera */ } }
  }

  /** Anticipo a proveedor: Dr 133005 anticipos / Cr banco. */
  async anticipo(input: AnticipoInput, actor?: string) {
    const monto = round2(D(input.monto));
    if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a cero.');
    this.validarDisponible(input.cuentaBanco);
    if (!input.beneficiario?.trim()) throw new BadRequestException('El beneficiario es obligatorio.');
    await this.asegurarCuenta(CUENTA_ANTICIPO, 'Anticipos y avances a proveedores');
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const concepto = input.concepto?.trim() || `Anticipo a ${input.beneficiario}`;
    const asiento = await this.posting.post({
      evento: 'treasury.movement', sourceModule: 'tesoreria',
      fecha, tipo: 'gasto', descripcion: `Anticipo: ${concepto}`, referencia: { tipo: 'tesoreria' },
      lineas: [
        { cuenta: CUENTA_ANTICIPO, debito: monto, descripcion: concepto },
        { cuenta: input.cuentaBanco, credito: monto, descripcion: concepto },
      ], actor,
    });
    return this.persistir('anticipo', { fecha, monto, concepto, beneficiario: input.beneficiario, cuentaOrigen: input.cuentaBanco, contraCuenta: CUENTA_ANTICIPO, asientoId: asiento.id, creadoPor: actor });
  }

  /** Legaliza un anticipo: Dr gasto/activo / Cr 133005 anticipos. */
  async legalizar(input: LegalizarInput, actor?: string) {
    const monto = round2(D(input.monto));
    if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a cero.');
    await this.asegurarCuenta(CUENTA_ANTICIPO, 'Anticipos y avances a proveedores');
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    const concepto = input.concepto?.trim() || 'Legalización de anticipo';
    const asiento = await this.posting.post({
      evento: 'treasury.movement', sourceModule: 'tesoreria',
      fecha, tipo: 'gasto', descripcion: `Legalización: ${concepto}`, referencia: { tipo: 'tesoreria' },
      lineas: [
        { cuenta: input.cuentaGasto, debito: monto, descripcion: concepto },
        { cuenta: CUENTA_ANTICIPO, credito: monto, descripcion: concepto },
      ], actor,
    });
    return this.persistir('legalizacion', { fecha, monto, concepto, beneficiario: input.beneficiario, contraCuenta: input.cuentaGasto, cuentaOrigen: CUENTA_ANTICIPO, asientoId: asiento.id, creadoPor: actor });
  }

  list(tipo?: string) {
    return this.prisma.movimientoTesoreria.findMany({ where: { tipo }, orderBy: { creadoEn: 'desc' }, take: 300 });
  }

  /** Saldos del disponible (11xx) derivados del ledger contabilizado. */
  async saldos() {
    const grupos = await this.prisma.movimientoContable.groupBy({
      by: ['cuentaCodigo'],
      where: { asiento: { estado: 'contabilizado' }, cuentaCodigo: { startsWith: '11' } },
      _sum: { debito: true, credito: true },
    });
    const cuentas = await this.prisma.cuentaContable.findMany({ where: { codigo: { in: grupos.map((g) => g.cuentaCodigo) } } });
    const byId = new Map(cuentas.map((c) => [c.codigo, c]));
    const filas = grupos
      .filter((g) => byId.get(g.cuentaCodigo)?.imputable)
      .map((g) => ({ codigo: g.cuentaCodigo, nombre: byId.get(g.cuentaCodigo)?.nombre ?? g.cuentaCodigo, saldo: round2(D(g._sum.debito) - D(g._sum.credito)) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    const total = round2(filas.reduce((s, f) => s + f.saldo, 0));
    return { total, cuentas: filas };
  }

  /** Flujo de caja proyectado a 30/60/90 días (disponible + CxC − CxP por vencimiento). */
  async flujoCaja() {
    const { total: disponible } = await this.saldos();
    const ahora = Date.now();
    const buckets = [30, 60, 90];

    const facturas = await this.prisma.factura.findMany({ where: { estado: { in: ['pendiente', 'vencida'] } }, include: { pagos: { where: { estado: 'aprobado' }, select: { monto: true } } } });
    const compras = await this.prisma.facturaCompra.findMany({ where: { estado: 'pendiente' }, select: { totalAPagar: true, fechaVencimiento: true } });

    const proyeccion = buckets.map((dias) => {
      const limite = ahora + dias * DAY;
      const cobrar = round2(facturas
        .filter((f) => f.fechaVencimiento.getTime() <= limite)
        .reduce((s, f) => s + Math.max(0, D(f.total) - f.pagos.reduce((p, x) => p + D(x.monto), 0)), 0));
      const pagar = round2(compras.filter((c) => c.fechaVencimiento.getTime() <= limite).reduce((s, c) => s + D(c.totalAPagar), 0));
      return { dias, cobrar, pagar, proyectado: round2(disponible + cobrar - pagar) };
    });
    return { disponible, proyeccion };
  }
}
