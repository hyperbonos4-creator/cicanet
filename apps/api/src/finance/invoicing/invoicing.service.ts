import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import { EInvoiceClient, type EInvoiceItem } from './einvoice.client';
import { config } from '../../config';

export interface EmitirFacturaInput {
  clienteId?: string;
  cliente: {
    tipo_documento: string;
    numero_documento: string;
    dv?: string;
    nombre_completo: string;
    email: string;
    telefono?: string;
    direccion?: Record<string, any>;
  };
  items: EInvoiceItem[];
  consecutivo?: string;
  notas?: string;
  /** Empresa emisora (CICANET) y config DIAN; si no se envían, se toman de env/Setting. */
  empresa?: Record<string, any>;
  configuracion_dian?: Record<string, any>;
  /** Cuenta de ingreso PUC (default 414505 servicio internet). */
  cuentaIngreso?: string;
  emitidoPor?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Orquesta la emisión de facturas electrónicas: arma el payload, llama al
 * microservicio DIAN, guarda el DianDocumento y CONTABILIZA el ingreso en el
 * ledger (CxC vs Ingreso + IVA). La fuente de verdad contable es el asiento,
 * no el XML.
 */
@Injectable()
export class InvoicingService {
  private readonly logger = new Logger('InvoicingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly einvoice: EInvoiceClient,
    private readonly accounting: AccountingService,
    private readonly posting: PostingEngineService,
  ) {}

  async health() {
    return { servicio: await this.einvoice.health(), habilitado: config.einvoice.enabled, ambiente: config.einvoice.ambiente };
  }

  async certificateStatus() {
    return this.einvoice.certificateStatus();
  }

  list(filtro: { estado?: string; clienteId?: string } = {}) {
    return this.prisma.dianDocumento.findMany({
      where: { estado: filtro.estado, clienteId: filtro.clienteId },
      orderBy: { creadoEn: 'desc' },
      take: 200,
    });
  }

  /** Calcula subtotal/iva/total de los items. */
  private totales(items: EInvoiceItem[]) {
    let subtotal = 0;
    let iva = 0;
    for (const it of items) {
      const base = round2((it.quantity || 0) * (it.price || 0));
      subtotal = round2(subtotal + base);
      iva = round2(iva + base * ((it.tax_percent || 0) / 100));
    }
    return { subtotal, iva, total: round2(subtotal + iva) };
  }

  /**
   * Emite una factura electrónica y la contabiliza. Si el microservicio o los
   * certificados no están listos, registra el documento en estado 'error'/'pendiente'
   * pero NUNCA revierte nada del negocio (best-effort, como el resto de CICANET).
   */
  async emitirFactura(input: EmitirFacturaInput) {
    if (!input.items?.length) throw new BadRequestException('La factura requiere al menos un item.');
    const { subtotal, iva, total } = this.totales(input.items);
    if (total <= 0) throw new BadRequestException('El total de la factura debe ser mayor a cero.');

    const empresa = input.empresa ?? (await this.empresaEmisora());
    const configDian = input.configuracion_dian ?? (await this.configDianGuardada());
    if (!empresa || !configDian) {
      throw new BadRequestException(
        'Faltan los datos del emisor o la configuración DIAN de CICANET. Configúralos antes de emitir (NIT, resolución, software, certificados).',
      );
    }

    // 1) Registrar el documento como pendiente (trazabilidad aunque falle DIAN).
    const doc = await this.prisma.dianDocumento.create({
      data: {
        tipo: 'factura',
        consecutivo: input.consecutivo ?? 'AUTO',
        estado: 'pendiente',
        ambiente: config.einvoice.ambiente,
        clienteId: input.clienteId ?? null,
        subtotal,
        iva,
        total,
        emitidoPor: input.emitidoPor ?? null,
      },
    });

    // 2) Llamar al microservicio DIAN.
    let estado = 'error';
    let cufe: string | undefined;
    let mensajes: any = null;
    try {
      const resp = await this.einvoice.generarYEnviar({
        empresa,
        cliente: input.cliente,
        items: input.items,
        configuracion_dian: configDian,
        consecutivo: input.consecutivo,
        notas: input.notas,
      });
      cufe = resp.cufe;
      estado = resp.success ? 'aceptada' : 'rechazada';
      mensajes = { errors: resp.errors ?? null, warnings: resp.warnings ?? null };
      await this.prisma.dianDocumento.update({
        where: { id: doc.id },
        data: { estado, cufe: cufe ?? null, consecutivo: resp.consecutivo || doc.consecutivo, mensajes, xmlBase64: resp.xml_base64 ?? null },
      });
    } catch (e: any) {
      mensajes = { error: e.message };
      await this.prisma.dianDocumento.update({ where: { id: doc.id }, data: { estado: 'error', mensajes } });
    }

    // 3) Contabilizar el ingreso (solo si la factura fue aceptada por la DIAN).
    let asientoId: string | null = null;
    if (estado === 'aceptada') {
      try {
        asientoId = await this.contabilizarVenta(input, subtotal, iva, total, doc.consecutivo);
        await this.prisma.dianDocumento.update({ where: { id: doc.id }, data: { asientoId } });
      } catch (e: any) {
        this.logger.warn(`Factura ${doc.consecutivo} emitida pero no contabilizada: ${e.message}`);
      }
    }

    return { id: doc.id, estado, cufe, asientoId, subtotal, iva, total, mensajes };
  }

  /** Crea el asiento de venta: Dr CxC ; Cr Ingreso ; Cr IVA generado. */
  private async contabilizarVenta(input: EmitirFacturaInput, subtotal: number, iva: number, total: number, consecutivo: string): Promise<string> {
    const cuentaIngreso = input.cuentaIngreso ?? '414505';
    // Asegurar tercero contable para la CxC (cuenta 130505 exige tercero).
    const tercero = await this.accounting.crearTercero({
      documento: input.cliente.numero_documento,
      nombre: input.cliente.nombre_completo,
      tipo: 'cliente',
      clienteId: input.clienteId,
    });

    const lineas: any[] = [
      { cuenta: '130505', debito: total, terceroId: tercero.id, descripcion: `CxC factura ${consecutivo}` },
      { cuenta: cuentaIngreso, credito: subtotal, descripcion: `Ingreso factura ${consecutivo}` },
    ];
    if (iva > 0) lineas.push({ cuenta: '240805', credito: iva, descripcion: `IVA generado factura ${consecutivo}` });

    const asiento = await this.posting.post({
      evento: 'invoice.issued',
      sourceModule: 'invoicing',
      tipo: 'venta',
      descripcion: `Factura electrónica ${consecutivo} - ${input.cliente.nombre_completo}`,
      referencia: { tipo: 'dian_factura', id: consecutivo },
      trazas: { clienteId: input.clienteId },
      lineas,
      actor: input.emitidoPor,
    });
    return asiento.id;
  }

  /** Datos del emisor (CICANET) desde Setting 'einvoice_emisor', si existe. */
  private async empresaEmisora(): Promise<Record<string, any> | null> {
    const s = await this.prisma.setting.findUnique({ where: { clave: 'einvoice_emisor' } });
    return (s?.valor as any) ?? null;
  }

  /** Config DIAN (resolución/software) desde Setting 'einvoice_dian', si existe. */
  private async configDianGuardada(): Promise<Record<string, any> | null> {
    const s = await this.prisma.setting.findUnique({ where: { clave: 'einvoice_dian' } });
    if (!s) return null;
    return { ...(s.valor as any), ambiente: config.einvoice.ambiente };
  }

  /** Guarda la parametrización del emisor + DIAN (solo admin). */
  async guardarConfig(emisor: Record<string, any>, dian: Record<string, any>, actor?: string) {
    await this.prisma.setting.upsert({
      where: { clave: 'einvoice_emisor' },
      update: { valor: emisor, actualizadoPor: actor },
      create: { clave: 'einvoice_emisor', valor: emisor, actualizadoPor: actor },
    });
    await this.prisma.setting.upsert({
      where: { clave: 'einvoice_dian' },
      update: { valor: dian, actualizadoPor: actor },
      create: { clave: 'einvoice_dian', valor: dian, actualizadoPor: actor },
    });
    return { ok: true };
  }
}
