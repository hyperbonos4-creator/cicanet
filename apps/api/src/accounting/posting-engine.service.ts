import { Injectable, Logger } from '@nestjs/common';
import { AccountingService, type LineaInput } from './accounting.service';

/** Catálogo de eventos de negocio que generan contabilidad (Fase B1). */
export type EventoContable =
  | 'invoice.issued'
  | 'invoice.voided'
  | 'payment.received'
  | 'payment.applied'
  | 'bank.movement.conciliated'
  | 'purchase.invoice.recorded'
  | 'purchase.invoice.paid'
  | 'service.suspended_for_debt'
  | 'writeoff.created'
  | 'credit.note.issued'
  | 'payroll.closed'
  | 'depreciation.posted'
  | 'treasury.movement'
  | 'manual.entry';

/** Mapa evento → tipo de comprobante por defecto. */
const TIPO_POR_EVENTO: Record<EventoContable, string> = {
  'invoice.issued': 'venta',
  'invoice.voided': 'reversion',
  'payment.received': 'recaudo',
  'payment.applied': 'recaudo',
  'bank.movement.conciliated': 'recaudo',
  'purchase.invoice.recorded': 'compra',
  'purchase.invoice.paid': 'gasto',
  'service.suspended_for_debt': 'ajuste',
  'writeoff.created': 'ajuste',
  'credit.note.issued': 'ajuste',
  'payroll.closed': 'ajuste',
  'depreciation.posted': 'depreciacion',
  'treasury.movement': 'gasto',
  'manual.entry': 'manual',
};

export interface PostInput {
  evento: EventoContable;
  sourceModule: string;
  descripcion: string;
  lineas: LineaInput[];
  fecha?: string | Date;
  tipo?: string;
  contabilizar?: boolean;
  actor?: string;
  referencia?: { tipo?: string; id?: string };
  trazas?: { napId?: string; zonaId?: string; servicioId?: string; clienteId?: string; dianDocumentoId?: string };
}

/**
 * Posting engine (emisor único de asientos por evento, Fase B1). En vez de que
 * cada módulo arme y contabilice asientos por su cuenta de forma dispersa, los
 * módulos describen el **evento de negocio** y el motor genera el comprobante con
 * trazabilidad de origen (módulo, evento, dimensiones operativas). Mantiene la
 * doble partida (delega el cuadre/validación en AccountingService) y deja el
 * `sourceModule`/`evento`/`autoGenerado` poblados para drill-down.
 */
@Injectable()
export class PostingEngineService {
  private readonly logger = new Logger('PostingEngine');

  constructor(private readonly accounting: AccountingService) {}

  async post(input: PostInput) {
    const asiento = await this.accounting.crearAsiento({
      fecha: input.fecha,
      tipo: input.tipo ?? TIPO_POR_EVENTO[input.evento] ?? 'manual',
      descripcion: input.descripcion,
      referenciaTipo: input.referencia?.tipo ?? input.evento,
      referenciaId: input.referencia?.id,
      lineas: input.lineas,
      contabilizar: input.contabilizar !== false,
      creadoPor: input.actor,
      sourceModule: input.sourceModule,
      evento: input.evento,
      autoGenerado: true,
      napId: input.trazas?.napId,
      zonaId: input.trazas?.zonaId,
      servicioId: input.trazas?.servicioId,
      clienteId: input.trazas?.clienteId,
      dianDocumentoId: input.trazas?.dianDocumentoId,
    });
    this.logger.debug(`${input.evento} → ${asiento.numero} (${input.sourceModule})`);
    return asiento;
  }
}
