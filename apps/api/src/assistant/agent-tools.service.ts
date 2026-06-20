import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GeoService } from '../geo/geo.service';
import { NetworkService } from '../network/network.service';
import { PaymentsService } from '../payments/payments.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SupportService } from '../support/support.service';
import { PrismaService } from '../prisma/prisma.service';
import { APP_MAP } from './knowledge';
import { config } from '../config';
import type { ToolSchema } from './llm.provider';

/**
 * Herramientas reales que el agente puede invocar (function calling). Aquí está
 * el verdadero valor del bot: responde con datos vivos de CICANET, no inventa.
 * Cada herramienta es una función pura de "argumentos -> resultado JSON".
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger('AgentToolsService');

  constructor(
    private readonly geo: GeoService,
    private readonly network: NetworkService,
    private readonly payments: PaymentsService,
    private readonly whatsapp: WhatsappService,
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
  ) {}

  /** Esquemas que se envían al modelo (formato OpenAI tools). */
  schemas(): ToolSchema[] {
    return [
      {
        type: 'function',
        function: {
          name: 'verificar_cobertura',
          description:
            'Verifica si una dirección tiene cobertura de fibra óptica CICANET. Úsala cuando el cliente pregunte si llega el servicio a su casa/barrio o quiera instalar.',
          parameters: {
            type: 'object',
            properties: {
              direccion: {
                type: 'string',
                description: 'Dirección o barrio del cliente, ej. "Calle 146 #120-10, Popular, Medellín".',
              },
            },
            required: ['direccion'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'info_pagos',
          description:
            'Devuelve los medios de pago disponibles (PSE, Nequi, tarjeta, transferencia) y los datos de la cuenta de la empresa. Úsala cuando pregunten cómo o dónde pagar.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_link_pago',
          description:
            'Genera un enlace de pago seguro (Wompi) por un monto en pesos. Úsala solo cuando el cliente confirme que quiere pagar un valor concreto.',
          parameters: {
            type: 'object',
            properties: {
              monto_cop: { type: 'number', description: 'Monto a pagar en pesos colombianos (COP), ej. 58000.' },
              descripcion: { type: 'string', description: 'Concepto del pago, ej. "Factura junio 2026".' },
            },
            required: ['monto_cop'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'contacto_asesor',
          description:
            'Devuelve el contacto de WhatsApp para hablar con un asesor humano. Úsala cuando el cliente pida hablar con una persona o el caso requiera atención humana.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'info_planes',
          description:
            'Información general de planes y tecnología de CICANET. Úsala cuando pregunten por planes, velocidades o precios.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'consultar_funciones_app',
          description:
            'Devuelve el mapa REAL de la app (pestañas y acciones). ÚSALA SIEMPRE antes de explicar cómo hacer algo en la app (cambiar contraseña, pagar, ver dispositivos, etc.) para no inventar pantallas ni botones.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_ticket',
          description:
            'Crea un ticket de soporte cuando el cliente reporta un problema o pide una gestión que requiere seguimiento (falla técnica, cambio de clave WiFi, visita, reclamo de factura). Confirma con el cliente antes de crearlo.',
          parameters: {
            type: 'object',
            properties: {
              asunto: { type: 'string', description: 'Resumen corto del problema o solicitud.' },
              descripcion: { type: 'string', description: 'Detalle de lo que reporta el cliente.' },
              categoria: {
                type: 'string',
                description: 'Una de: tecnico, facturacion, comercial, general.',
              },
              contacto: { type: 'string', description: 'Nombre o teléfono del cliente (opcional).' },
            },
            required: ['asunto', 'descripcion'],
          },
        },
      },
    ];
  }

  /** Ejecuta una herramienta por nombre. Devuelve un objeto serializable. */
  async execute(
    name: string,
    args: Record<string, any>,
    ctx?: { creadoPor?: string; nombre?: string },
  ): Promise<unknown> {
    try {
      switch (name) {
        case 'verificar_cobertura':
          return await this.verificarCobertura(String(args?.direccion ?? ''));
        case 'info_pagos':
          return this.infoPagos();
        case 'crear_link_pago':
          return await this.crearLinkPago(Number(args?.monto_cop), args?.descripcion);
        case 'contacto_asesor':
          return await this.contactoAsesor();
        case 'info_planes':
          return this.infoPlanes();
        case 'consultar_funciones_app':
          return APP_MAP;
        case 'crear_ticket':
          return await this.crearTicket(args, ctx);
        default:
          return { error: `herramienta_desconocida: ${name}` };
      }
    } catch (e: any) {
      this.logger.warn(`Tool ${name} falló: ${e.message}`);
      return { error: 'no_se_pudo_ejecutar', detalle: e.message };
    }
  }

  // --- Implementaciones ---

  private async verificarCobertura(direccion: string) {
    if (!direccion || direccion.length < 4) {
      return { ok: false, mensaje: 'Necesito una dirección o barrio para verificar.' };
    }
    const candidatos = await this.geo.geocode(direccion);
    const c = candidatos?.[0];
    if (!c) {
      return { ok: false, mensaje: 'No pude ubicar esa dirección. Pide una más específica con barrio.' };
    }
    const cobertura = this.network.checkCoverage(c.lng, c.lat);
    return {
      ok: true,
      direccionInterpretada: c.displayName,
      cobertura: cobertura.cobertura,
      estado: cobertura.estado,
      mensaje: cobertura.mensaje,
      napCercano: cobertura.napCercano
        ? { nombre: cobertura.napCercano.nombre, metros: cobertura.napCercano.metros, puertosLibres: cobertura.napCercano.libres }
        : null,
    };
  }

  private infoPagos() {
    const manual = this.support; // no usado directamente aquí
    void manual;
    return {
      enLinea: !!config.wompi.publicKey,
      medios: ['PSE (todos los bancos)', 'Nequi', 'Tarjeta crédito/débito', 'Transferencia Bancolombia'],
      procesador: 'Wompi (Grupo Bancolombia)',
      transferenciaManual: {
        nequi: config.wompi.nequiEmpresa || null,
        bancolombia: config.wompi.bancolombiaEmpresa || null,
        titular: 'CICANET',
      },
      comoPagar:
        'Desde la app CICANET: Facturas → Pagar → elegir medio. El pago se acredita y el servicio se reactiva automáticamente.',
    };
  }

  private async crearLinkPago(montoCop: number, descripcion?: string) {
    if (!Number.isFinite(montoCop) || montoCop < 1500) {
      return { ok: false, mensaje: 'Indica un monto válido en pesos (mínimo $1.500).' };
    }
    const checkout = await this.payments.createCheckout({
      montoCents: Math.round(montoCop * 100),
      descripcion: descripcion || 'Pago CICANET',
    });
    return {
      ok: true,
      url: checkout.checkoutUrl,
      referencia: checkout.referencia,
      monto: montoCop,
      mensaje: 'Comparte este enlace seguro de Wompi para completar el pago.',
    };
  }

  private async contactoAsesor() {
    const manual = await this.support.getWhatsapp();
    const escaneado = this.whatsapp.contact(manual.mensaje);
    const url = escaneado.habilitado ? escaneado.url : manual.url;
    return {
      disponible: !!url,
      url,
      mensaje: url
        ? 'Puedes hablar con un asesor por WhatsApp con este enlace.'
        : 'Por ahora la atención por WhatsApp no está disponible; intenta en horario de oficina.',
    };
  }

  private infoPlanes() {
    return {
      tecnologia: 'FTTH (fibra óptica hasta el hogar)',
      segmentos: ['Hogar', 'Empresarial'],
      nota: 'Las velocidades y precios exactos dependen del plan vigente en la zona del cliente. Un asesor confirma el plan ideal según el uso (streaming, teletrabajo, varios dispositivos).',
    };
  }

  private async crearTicket(args: Record<string, any>, ctx?: { creadoPor?: string; nombre?: string }) {
    const asunto = String(args?.asunto ?? '').trim();
    const descripcion = String(args?.descripcion ?? '').trim();
    if (asunto.length < 3 || descripcion.length < 3) {
      return { ok: false, mensaje: 'Falta el asunto o la descripción del problema.' };
    }
    const cats = ['tecnico', 'facturacion', 'comercial', 'general'];
    const categoria = cats.includes(String(args?.categoria)) ? String(args.categoria) : 'general';
    const codigo = `TCK-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const contacto = args?.contacto ? String(args.contacto).slice(0, 120) : ctx?.nombre ?? null;
    const ticket = await this.prisma.ticket.create({
      data: {
        codigo,
        asunto: asunto.slice(0, 200),
        descripcion: descripcion.slice(0, 2000),
        categoria,
        contacto,
        origen: 'asistente',
        creadoPor: ctx?.creadoPor ?? null,
      },
    });
    this.logger.log(`Ticket creado ${ticket.codigo} (${categoria}) por ${ctx?.creadoPor ?? 'anónimo'}`);
    return {
      ok: true,
      codigo: ticket.codigo,
      categoria,
      mensaje: `Ticket ${ticket.codigo} creado. Nuestro equipo le dará seguimiento.`,
    };
  }
}
