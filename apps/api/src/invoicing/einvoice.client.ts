import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../config';

/** Item de una factura electrónica (contrato del microservicio einvoice). */
export interface EInvoiceItem {
  quantity: number;
  description: string;
  price: number;
  sku?: string;
  tax_percent?: number;
}

export interface EInvoiceRequest {
  empresa: Record<string, any>;
  cliente: Record<string, any>;
  items: EInvoiceItem[];
  configuracion_dian: Record<string, any>;
  consecutivo?: string;
  forma_pago?: string;
  medio_pago?: string;
  notas?: string;
}

export interface EInvoiceResponse {
  success: boolean;
  consecutivo: string;
  cufe?: string;
  xml_base64?: string;
  dian_response?: Record<string, any>;
  errors?: string[];
  warnings?: string[];
}

/**
 * Cliente HTTP del microservicio de facturación electrónica DIAN (einvoice).
 * Vive en la red interna de Docker; se autentica con X-API-Key. Confidencial:
 * la API key viaja solo en el header, nunca se loguea ni se devuelve al cliente.
 */
@Injectable()
export class EInvoiceClient {
  private readonly logger = new Logger('EInvoiceClient');

  private headers() {
    return { 'Content-Type': 'application/json', 'X-API-Key': config.einvoice.apiKey };
  }

  get enabled() {
    return config.einvoice.enabled;
  }

  /** Estado del microservicio (no requiere API key). */
  async health(): Promise<{ ok: boolean; detalle?: any }> {
    try {
      const res = await fetch(`${config.einvoice.url}/api/health`, { method: 'GET' });
      if (!res.ok) return { ok: false };
      return { ok: true, detalle: await res.json() };
    } catch (e: any) {
      return { ok: false, detalle: e.message };
    }
  }

  /** Estado de los certificados cargados para el NIT emisor. */
  async certificateStatus(): Promise<any> {
    return this.call('GET', '/api/certificate/status');
  }

  /** Genera, firma y envía una factura a la DIAN. */
  async generarYEnviar(req: EInvoiceRequest): Promise<EInvoiceResponse> {
    return this.call('POST', '/api/invoice/generate-and-send', req);
  }

  /** Solo genera el XML firmado (sin enviar) — útil para previsualizar/validar. */
  async generarXml(req: EInvoiceRequest): Promise<EInvoiceResponse> {
    return this.call('POST', '/api/invoice/generate-xml', req);
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    if (!config.einvoice.enabled) {
      throw new ServiceUnavailableException('La facturación electrónica está deshabilitada (EINVOICE_ENABLED=false).');
    }
    let res: Response;
    try {
      res = await fetch(`${config.einvoice.url}${path}`, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      this.logger.warn(`einvoice inalcanzable: ${e.message}`);
      throw new ServiceUnavailableException('No se pudo contactar el servicio de facturación electrónica.');
    }
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
    if (!res.ok) {
      this.logger.warn(`einvoice HTTP ${res.status}: ${String(data?.detail).slice(0, 200)}`);
      throw new ServiceUnavailableException(data?.detail || `einvoice respondió ${res.status}`);
    }
    return data;
  }
}
