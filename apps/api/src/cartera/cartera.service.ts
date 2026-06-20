import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService } from '../accounting/posting-engine.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CrearAcuerdoInput {
  clienteId: string;
  montoTotal: number;
  numeroCuotas: number;
  periodicidad?: 'mensual' | 'quincenal';
  fechaInicio?: string;
  notas?: string;
  creadoPor?: string;
}

/**
 * Cartera avanzada: acuerdos de pago / refinanciación (plan de cuotas) y castigo
 * de cartera incobrable (write-off, Dr 531595 / Cr 130505). Los pagos del acuerdo
 * fluyen por el recibo de caja normal; aquí se gestiona el plan y su estado.
 */
@Injectable()
export class CarteraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly posting: PostingEngineService,
  ) {}

  private async siguienteNumero(): Promise<string> {
    const n = await this.prisma.acuerdoPago.count();
    return `ACU-${String(n + 1).padStart(6, '0')}`;
  }

  /** Resuelve un cliente por UUID, código público (CLI-xxxx) o documento. */
  private async resolverCliente(ref: string) {
    const v = (ref ?? '').trim();
    if (!v) throw new BadRequestException('Falta el identificador del cliente.');
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const cliente = await this.prisma.cliente.findFirst({
      where: esUuid ? { id: v } : { OR: [{ codigo: v }, { documento: v }] },
    });
    if (!cliente) throw new BadRequestException('Cliente no encontrado.');
    return cliente;
  }

  async crearAcuerdo(input: CrearAcuerdoInput) {
    const cliente = await this.resolverCliente(input.clienteId);
    const total = round2(D(input.montoTotal));
    if (total <= 0) throw new BadRequestException('El monto total debe ser mayor a cero.');
    if (!Number.isInteger(input.numeroCuotas) || input.numeroCuotas < 1) throw new BadRequestException('Número de cuotas inválido.');

    const periodicidad = input.periodicidad === 'quincenal' ? 'quincenal' : 'mensual';
    const valorCuota = round2(total / input.numeroCuotas);
    const inicio = input.fechaInicio ? new Date(input.fechaInicio) : new Date();
    const cuotas: { n: number; fecha: string; valor: number; estado: string }[] = [];
    let acumulado = 0;
    for (let i = 1; i <= input.numeroCuotas; i++) {
      const fecha = new Date(inicio);
      if (periodicidad === 'mensual') fecha.setUTCMonth(fecha.getUTCMonth() + (i - 1));
      else fecha.setUTCDate(fecha.getUTCDate() + 15 * (i - 1));
      // La última cuota ajusta el redondeo.
      const valor = i === input.numeroCuotas ? round2(total - acumulado) : valorCuota;
      acumulado = round2(acumulado + valor);
      cuotas.push({ n: i, fecha: fecha.toISOString().slice(0, 10), valor, estado: 'pendiente' });
    }

    const numero = await this.siguienteNumero();
    return this.prisma.acuerdoPago.create({
      data: {
        numero, clienteId: cliente.id, clienteNombre: cliente.nombre,
        fechaAcuerdo: inicio, montoTotal: total, numeroCuotas: input.numeroCuotas,
        periodicidad, cuotas: cuotas as any, notas: input.notas ?? null, creadoPor: input.creadoPor ?? null,
      },
    });
  }

  listAcuerdos(filtro: { estado?: string; clienteId?: string } = {}) {
    return this.prisma.acuerdoPago.findMany({ where: { estado: filtro.estado, clienteId: filtro.clienteId }, orderBy: { creadoEn: 'desc' }, take: 200 });
  }

  async getAcuerdo(id: string) {
    const a = await this.prisma.acuerdoPago.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Acuerdo no encontrado.');
    return a;
  }

  /** Marca una cuota como pagada y actualiza el estado del acuerdo. */
  async marcarCuota(id: string, n: number, pagada = true) {
    const acuerdo = await this.getAcuerdo(id);
    const cuotas = (acuerdo.cuotas as any[]).map((c) => (c.n === n ? { ...c, estado: pagada ? 'pagada' : 'pendiente' } : c));
    const todas = cuotas.every((c) => c.estado === 'pagada');
    return this.prisma.acuerdoPago.update({ where: { id }, data: { cuotas: cuotas as any, estado: todas ? 'cumplido' : acuerdo.estado } });
  }

  async cambiarEstado(id: string, estado: string) {
    if (!['vigente', 'cumplido', 'incumplido', 'cancelado'].includes(estado)) throw new BadRequestException('Estado inválido.');
    await this.getAcuerdo(id);
    return this.prisma.acuerdoPago.update({ where: { id }, data: { estado } });
  }

  /** Castiga (write-off) cartera incobrable: Dr 531595 gasto, Cr 130505 CxC (tercero). */
  async castigar(input: { clienteId: string; monto: number; concepto?: string; facturaIds?: string[]; actor?: string }) {
    const cliente = await this.resolverCliente(input.clienteId);
    const monto = round2(D(input.monto));
    if (monto <= 0) throw new BadRequestException('El monto a castigar debe ser mayor a cero.');

    const tercero = await this.accounting.crearTercero({ documento: cliente.documento, nombre: cliente.nombre, tipo: 'cliente', clienteId: cliente.id });
    const asiento = await this.posting.post({
      evento: 'writeoff.created',
      sourceModule: 'cartera',
      descripcion: `Castigo de cartera - ${cliente.nombre}${input.concepto ? ': ' + input.concepto : ''}`,
      tipo: 'ajuste',
      referencia: { tipo: 'castigo_cartera', id: cliente.id },
      trazas: { clienteId: cliente.id },
      lineas: [
        { cuenta: '531595', debito: monto, descripcion: 'Cartera incobrable' },
        { cuenta: '130505', credito: monto, terceroId: tercero.id, descripcion: `Castigo CxC ${cliente.nombre}` },
      ],
      actor: input.actor,
    });

    // Marcar facturas como castigadas (si se indicaron).
    if (input.facturaIds?.length) {
      await this.prisma.factura.updateMany({ where: { id: { in: input.facturaIds } }, data: { estado: 'castigada' } });
    }
    return { ok: true, asiento: asiento.numero, monto };
  }
}
