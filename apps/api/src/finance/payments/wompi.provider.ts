import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { config, wompiUrls } from '../../config';

/**
 * Contrato de pasarela de pago (abstracción documentada en 08-PAGOS-WOMPI).
 * Permite añadir ePayco/Bold sin reescribir el dominio.
 */
export interface PaymentProvider {
  readonly nombre: string;
  buildCheckout(input: CheckoutInput): CheckoutData;
  verifyWebhook(event: any): boolean;
  getTransaction(id: string): Promise<any>;
}

export interface CheckoutInput {
  reference: string;
  amountInCents: number;
  currency: string;
  redirectUrl: string;
  customerEmail?: string;
}

export interface CheckoutData {
  reference: string;
  amountInCents: number;
  currency: string;
  publicKey: string;
  signature: string;
  redirectUrl: string;
  /** URL del Checkout Web de Wompi (muestra PSE, Nequi, tarjetas, Bancolombia). */
  checkoutUrl: string;
}

/**
 * Integración real con Wompi (Colombia). Soporta sandbox y producción según
 * `WOMPI_ENV`. No maneja datos de tarjeta: eso vive en el checkout de Wompi (PCI).
 */
@Injectable()
export class WompiProvider implements PaymentProvider {
  readonly nombre = 'wompi';
  private readonly logger = new Logger('WompiProvider');

  /** Firma de integridad del checkout: SHA256(reference + amountInCents + currency + secret). */
  integritySignature(reference: string, amountInCents: number, currency: string): string {
    const raw = `${reference}${amountInCents}${currency}${config.wompi.integritySecret}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  buildCheckout(input: CheckoutInput): CheckoutData {
    const signature = this.integritySignature(input.reference, input.amountInCents, input.currency);
    const params = new URLSearchParams({
      'public-key': config.wompi.publicKey,
      currency: input.currency,
      'amount-in-cents': String(input.amountInCents),
      reference: input.reference,
      'signature:integrity': signature,
      'redirect-url': input.redirectUrl,
    });
    if (input.customerEmail) params.set('customer-data:email', input.customerEmail);
    return {
      reference: input.reference,
      amountInCents: input.amountInCents,
      currency: input.currency,
      publicKey: config.wompi.publicKey,
      signature,
      redirectUrl: input.redirectUrl,
      checkoutUrl: `${wompiUrls.checkout}?${params.toString()}`,
    };
  }

  /**
   * Verifica el checksum del evento (webhook). Wompi firma:
   * SHA256( valores de signature.properties + timestamp + secreto_eventos ).
   */
  verifyWebhook(event: any): boolean {
    try {
      const props: string[] = event?.signature?.properties || [];
      const received: string = (event?.signature?.checksum || '').toString();
      const timestamp = event?.timestamp ?? '';
      if (!props.length || !received) return false;

      const values = props.map((p) => this.getByPath(event.data, p) ?? '');
      const raw = `${values.join('')}${timestamp}${config.wompi.eventsSecret}`;
      const computed = createHash('sha256').update(raw).digest('hex');
      return computed.toLowerCase() === received.toLowerCase();
    } catch (e: any) {
      this.logger.warn(`No se pudo verificar el webhook: ${e.message}`);
      return false;
    }
  }

  /** Consulta el estado de una transacción en la API de Wompi. */
  async getTransaction(id: string): Promise<any> {
    const res = await fetch(`${wompiUrls.api}/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${config.wompi.privateKey}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Wompi HTTP ${res.status}`);
    const json = await res.json();
    return json?.data;
  }

  /** "transaction.id" -> event.data.transaction.id */
  private getByPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
  }
}
