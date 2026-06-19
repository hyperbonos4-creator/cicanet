import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import { WompiProvider } from './wompi.provider';

/** Mapea el estado de Wompi al estado interno de la transacción. */
function mapEstado(wompiStatus?: string): string {
  switch ((wompiStatus || '').toUpperCase()) {
    case 'APPROVED':
      return 'APROBADA';
    case 'DECLINED':
    case 'ERROR':
      return 'RECHAZADA';
    case 'VOIDED':
      return 'ANULADA';
    case 'PENDING':
      return 'PENDIENTE';
    default:
      return 'PENDIENTE';
  }
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('PaymentsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly wompi: WompiProvider,
  ) {}

  /** Datos de pago manual (Nequi/Bancolombia de la empresa) como alternativa. */
  manualInfo() {
    return {
      nequi: config.wompi.nequiEmpresa || null,
      bancolombia: config.wompi.bancolombiaEmpresa || null,
      titular: 'CICANET',
    };
  }

  /**
   * Crea la intención de pago y devuelve los datos del Checkout de Wompi.
   * Si se pasa `facturaId`, el monto sale de la factura; si no, de `montoCents`.
   */
  async createCheckout(input: {
    facturaId?: string;
    montoCents?: number;
    descripcion?: string;
    email?: string;
    clienteId?: string;
    creadoPor?: string;
  }) {
    if (!config.wompi.publicKey || !config.wompi.integritySecret) {
      throw new BadRequestException(
        'La pasarela no está configurada (faltan llaves de Wompi en el servidor).',
      );
    }

    let amountInCents: number;
    let descripcion = input.descripcion;

    if (input.facturaId) {
      const factura = await this.prisma.factura.findUnique({ where: { id: input.facturaId } });
      if (!factura) throw new NotFoundException('Factura no encontrada.');
      if (factura.estado === 'pagada') throw new BadRequestException('La factura ya está pagada.');
      amountInCents = Math.round(Number(factura.total) * 100);
      descripcion = descripcion || `Factura ${factura.periodo}`;
    } else if (typeof input.montoCents === 'number') {
      amountInCents = Math.round(input.montoCents);
    } else {
      throw new BadRequestException('Indica una factura (facturaId) o un monto (montoCents).');
    }

    if (amountInCents < 1500) {
      throw new BadRequestException('El monto mínimo de pago no es válido.');
    }

    const moneda = config.wompi.moneda;
    const referencia = this.nextReference();

    const checkout = this.wompi.buildCheckout({
      reference: referencia,
      amountInCents,
      currency: moneda,
      redirectUrl: config.wompi.redirectUrl,
      customerEmail: input.email,
    });

    await this.prisma.pagoTransaccion.create({
      data: {
        referencia,
        proveedor: 'wompi',
        montoCents: amountInCents,
        moneda,
        estado: 'CREADA',
        descripcion,
        emailCliente: input.email,
        facturaId: input.facturaId ?? null,
        clienteId: input.clienteId ?? null,
        creadoPor: input.creadoPor,
      },
    });

    this.logger.log(`Checkout creado ${referencia} por ${amountInCents} ${moneda} cents`);

    return {
      referencia,
      montoCents: amountInCents,
      moneda,
      descripcion,
      publicKey: checkout.publicKey,
      signature: checkout.signature,
      redirectUrl: checkout.redirectUrl,
      checkoutUrl: checkout.checkoutUrl,
      // El frontend puede abrir checkoutUrl directamente (Web Checkout).
    };
  }

  /**
   * Procesa el webhook de Wompi. Verifica firma, es idempotente y al aprobarse
   * marca la factura como pagada (si existe) y registra el Pago.
   */
  async handleWebhook(event: any) {
    if (!this.wompi.verifyWebhook(event)) {
      this.logger.warn('Webhook con firma inválida — ignorado.');
      // Respondemos 200 igual para que Wompi no reintente infinitamente,
      // pero NO procesamos nada.
      return { ok: false, reason: 'firma_invalida' };
    }

    const tx = event?.data?.transaction;
    if (!tx?.reference) return { ok: false, reason: 'sin_referencia' };

    const registro = await this.prisma.pagoTransaccion.findUnique({
      where: { referencia: tx.reference },
    });
    if (!registro) {
      this.logger.warn(`Webhook de referencia desconocida: ${tx.reference}`);
      return { ok: true, reason: 'desconocida' };
    }

    // Idempotencia: si ya está en estado final, no reprocesar.
    if (registro.estado === 'APROBADA') return { ok: true, idempotente: true };

    const estado = mapEstado(tx.status);
    await this.prisma.pagoTransaccion.update({
      where: { referencia: tx.reference },
      data: {
        estado,
        proveedorTxId: tx.id?.toString(),
        metodo: tx.payment_method_type?.toString(),
        datosWompi: tx,
      },
    });

    if (estado === 'APROBADA' && registro.facturaId) {
      await this.marcarFacturaPagada(registro.facturaId, tx);
      // Aquí se encolaría la reactivación del servicio (RADIUS/CoA) — P2.
    }

    this.logger.log(`Pago ${tx.reference} → ${estado}`);
    return { ok: true, estado };
  }

  /** Marca la factura pagada y registra el Pago (idempotente por referencia). */
  private async marcarFacturaPagada(facturaId: string, tx: any) {
    await this.prisma.$transaction(async (db) => {
      await db.factura.update({ where: { id: facturaId }, data: { estado: 'pagada' } });
      const existente = await db.pago.findUnique({
        where: { referenciaExterna: tx.reference },
      });
      if (!existente) {
        await db.pago.create({
          data: {
            facturaId,
            monto: (tx.amount_in_cents ?? 0) / 100,
            metodo: 'wompi',
            referenciaExterna: tx.reference,
            estado: 'aprobado',
            pagadoEn: new Date(),
          },
        });
      }
    });
  }

  /** Estado de una transacción; refresca desde Wompi si sigue pendiente. */
  async getStatus(referencia: string) {
    const registro = await this.prisma.pagoTransaccion.findUnique({ where: { referencia } });
    if (!registro) throw new NotFoundException('Transacción no encontrada.');

    if (registro.proveedorTxId && ['CREADA', 'PENDIENTE'].includes(registro.estado)) {
      try {
        const tx = await this.wompi.getTransaction(registro.proveedorTxId);
        if (tx) {
          const estado = mapEstado(tx.status);
          if (estado !== registro.estado) {
            await this.prisma.pagoTransaccion.update({ where: { referencia }, data: { estado, datosWompi: tx } });
            if (estado === 'APROBADA' && registro.facturaId) {
              await this.marcarFacturaPagada(registro.facturaId, { ...tx, reference: referencia });
            }
            registro.estado = estado;
          }
        }
      } catch (e: any) {
        this.logger.warn(`No se pudo refrescar ${referencia}: ${e.message}`);
      }
    }

    return {
      referencia: registro.referencia,
      estado: registro.estado,
      montoCents: registro.montoCents,
      moneda: registro.moneda,
      metodo: registro.metodo,
      descripcion: registro.descripcion,
    };
  }

  private nextReference(): string {
    return `CICA-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`.toUpperCase();
  }
}
