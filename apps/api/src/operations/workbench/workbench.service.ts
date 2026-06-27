import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ReportsService } from '../../finance/accounting/reports.service';
import { AccountingService } from '../../finance/accounting/accounting.service';
import { CollectionsService } from '../../finance/collections/collections.service';
import { DianService } from '../../compliance/dian/dian.service';
import { AssetRegistryService } from '../../finance/asset-registry/asset-registry.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$ ${Math.round(n).toLocaleString('es-CO')}`;

type Severidad = 'critica' | 'atencion' | 'info';
type EstadoIndicador = 'bueno' | 'alerta' | 'malo' | 'neutro';

export interface Alerta {
  clave: string;
  severidad: Severidad;
  titulo: string;
  detalle: string;
  tab: string;
  accion: string;
}

export interface Indicador {
  clave: string;
  titulo: string;
  valor: string;
  estado: EstadoIndicador;
  ayuda: string;
  tab?: string;
}

export interface ObligacionTributaria {
  clave: string;
  titulo: string;
  fecha: string; // YYYY-MM-DD
  diasRestantes: number;
  severidad: Severidad;
  detalle: string;
  tab: string;
}

const ORDEN_SEVERIDAD: Record<Severidad, number> = { critica: 0, atencion: 1, info: 2 };

/**
 * Workbench del contador. Dos vistas:
 *  - `resumen()`: bandeja de "pendientes del día" (tareas accionables).
 *  - `salud()`: centro de control financiero — motor de alertas por excepción
 *    (con severidad y drill-down), indicadores de salud (liquidez, endeudamiento,
 *    margen, rotación de cartera) y calendario tributario. Reúsa los servicios de
 *    reportes/cartera/cierre/DIAN/activos como fuente única de verdad (no duplica
 *    lógica contable).
 */
@Injectable()
export class WorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly accounting: AccountingService,
    private readonly collections: CollectionsService,
    private readonly dian: DianService,
    private readonly assets: AssetRegistryService,
  ) {}

  private periodoActual(): string {
    const ahora = new Date();
    return `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async resumen() {
    const ahora = new Date();
    const periodo = this.periodoActual();

    const [
      recibos, movsSinConciliar, comprasPend, facturasVencidas,
      comprobantesBorrador, dianRechazados, empleadosActivos, liquidacionesMes,
    ] = await Promise.all([
      this.prisma.reciboCaja.findMany({ where: { estado: { in: ['sin_aplicar', 'parcial'] } }, select: { saldoPorAplicar: true, clienteId: true } }),
      this.prisma.movimientoBancario.count({ where: { estado: 'sin_conciliar' } }),
      this.prisma.facturaCompra.findMany({ where: { estado: 'pendiente' }, select: { totalAPagar: true, fechaVencimiento: true } }),
      this.prisma.factura.findMany({ where: { estado: { in: ['pendiente', 'vencida'] }, fechaVencimiento: { lt: ahora } }, select: { id: true } }),
      this.prisma.asientoContable.count({ where: { estado: 'borrador' } }),
      this.prisma.dianDocumento.count({ where: { estado: { in: ['rechazada', 'error'] } } }),
      this.prisma.empleado.count({ where: { estado: 'activo' } }),
      this.prisma.liquidacionNomina.count({ where: { periodo } }),
    ]);

    const recibosPorAplicar = recibos.length;
    const saldoPorAplicar = round2(recibos.reduce((s, r) => s + D(r.saldoPorAplicar), 0));
    const recibosHuerfanos = recibos.filter((r) => !r.clienteId).length;
    const comprasVencidas = comprasPend.filter((c) => c.fechaVencimiento.getTime() < ahora.getTime()).length;
    const comprasPorPagar = round2(comprasPend.reduce((s, c) => s + D(c.totalAPagar), 0));

    return {
      periodo,
      tarjetas: [
        { clave: 'recaudo', titulo: 'Recibos por aplicar', valor: recibosPorAplicar, detalle: `${saldoPorAplicar.toLocaleString('es-CO')} sin aplicar`, alerta: recibosHuerfanos > 0 ? `${recibosHuerfanos} sin identificar` : null, tab: 'recibos' },
        { clave: 'bancos', titulo: 'Movimientos sin conciliar', valor: movsSinConciliar, detalle: 'pendientes de cruce', alerta: movsSinConciliar > 0 ? 'requiere conciliación' : null, tab: 'bancos' },
        { clave: 'cartera', titulo: 'Facturas vencidas', valor: facturasVencidas.length, detalle: 'cartera en mora', alerta: facturasVencidas.length > 0 ? 'gestionar cobro' : null, tab: 'cartera' },
        { clave: 'cxp', titulo: 'Compras por pagar', valor: comprasPend.length, detalle: `${comprasPorPagar.toLocaleString('es-CO')} por pagar`, alerta: comprasVencidas > 0 ? `${comprasVencidas} vencidas` : null, tab: 'compras' },
        { clave: 'comprobantes', titulo: 'Comprobantes en borrador', valor: comprobantesBorrador, detalle: 'sin contabilizar', alerta: comprobantesBorrador > 0 ? 'revisar' : null, tab: 'asientos' },
        { clave: 'dian', titulo: 'Documentos DIAN rechazados', valor: dianRechazados, detalle: 'requieren reproceso', alerta: dianRechazados > 0 ? 'reprocesar' : null, tab: 'dian' },
        { clave: 'nomina', titulo: 'Nómina del mes', valor: Math.max(0, empleadosActivos - liquidacionesMes), detalle: `${empleadosActivos} empleado(s) activos`, alerta: empleadosActivos - liquidacionesMes > 0 ? 'pendiente de liquidar' : null, tab: 'nomina' },
      ],
    };
  }

  /**
   * Centro de control financiero: alertas por excepción + indicadores de salud +
   * calendario tributario. Pensado para que el contador vea de un vistazo "qué está
   * mal" (no solo "qué falta hacer").
   */
  async salud(periodo?: string) {
    const per = periodo ?? this.periodoActual();
    const hoy = new Date();
    const hasta = hoy.toISOString().slice(0, 10);

    const [dash, situacion, checklist, cartera, dianCfg, dianRech, activos, comprasPend] = await Promise.all([
      this.reports.dashboard(per),
      this.reports.situacionFinancieraNiif(hasta),
      this.accounting.checklistCierre(per),
      this.collections.resumen(),
      this.dian.getConfig(),
      this.prisma.dianDocumento.count({ where: { estado: { in: ['rechazada', 'error'] } } }),
      this.assets.resumen(),
      this.prisma.facturaCompra.findMany({ where: { estado: 'pendiente' }, select: { totalAPagar: true, fechaVencimiento: true } }),
    ]);

    const recibosHuerfanos = await this.prisma.reciboCaja.count({ where: { estado: { in: ['sin_aplicar', 'parcial'] }, clienteId: null } });
    const comprasVencidas = comprasPend.filter((c) => c.fechaVencimiento.getTime() < hoy.getTime());

    const t = situacion.totales;
    const alertas = this.construirAlertas({ dash, t, checklist, cartera, dianCfg, dianRech, activos, recibosHuerfanos, comprasVencidas: comprasVencidas.length, comprasVencidasMonto: round2(comprasVencidas.reduce((s, c) => s + D(c.totalAPagar), 0)) });
    const indicadores = this.construirIndicadores({ dash, t });
    const calendario = this.calendarioTributario(hoy, dianCfg);

    // Semáforo global: el peor estado entre alertas presentes.
    const tieneCritica = alertas.some((a) => a.severidad === 'critica');
    const tieneAtencion = alertas.some((a) => a.severidad === 'atencion');
    const estadoGlobal: 'critico' | 'atencion' | 'sano' = tieneCritica ? 'critico' : tieneAtencion ? 'atencion' : 'sano';

    return {
      periodo: per,
      generadoEn: hoy.toISOString(),
      estadoGlobal,
      resumenAlertas: {
        criticas: alertas.filter((a) => a.severidad === 'critica').length,
        atencion: alertas.filter((a) => a.severidad === 'atencion').length,
        info: alertas.filter((a) => a.severidad === 'info').length,
      },
      alertas,
      indicadores,
      calendario,
    };
  }

  // ---- Motor de alertas por excepción ----
  private construirAlertas(ctx: {
    dash: { ingresos: number; gastos: number; utilidadNeta: number; cartera: number; bancosCaja: number };
    t: any;
    checklist: { items: { clave: string; titulo: string; estado: string; detalle: string }[] };
    cartera: { totalVencido: number; clientesConDeuda: number; buckets: Record<string, number> };
    dianCfg: any;
    dianRech: number;
    activos: { sinCapitalizar: number };
    recibosHuerfanos: number;
    comprasVencidas: number;
    comprasVencidasMonto: number;
  }): Alerta[] {
    const a: Alerta[] = [];
    const { dash, t, checklist, cartera, dianCfg, dianRech, activos, recibosHuerfanos, comprasVencidas, comprasVencidasMonto } = ctx;
    const item = (clave: string) => checklist.items.find((i) => i.clave === clave);

    // --- Críticas ---
    if (dash.bancosCaja < 0) {
      a.push({ clave: 'banco_negativo', severidad: 'critica', titulo: 'Disponible en negativo', detalle: `Bancos y caja en ${money(dash.bancosCaja)}. Revise sobregiros o movimientos sin registrar.`, tab: 'tesoreria', accion: 'Ir a tesorería' });
    }
    const cuadre = item('cuadre');
    if (cuadre && cuadre.estado === 'error') {
      a.push({ clave: 'descuadre', severidad: 'critica', titulo: 'Partida doble descuadrada', detalle: cuadre.detalle, tab: 'periodos', accion: 'Revisar cierre' });
    }
    if (dianRech > 0) {
      a.push({ clave: 'dian_rechazados', severidad: 'critica', titulo: 'Documentos DIAN rechazados', detalle: `${dianRech} documento(s) rechazado(s) o con error. Requieren reproceso.`, tab: 'dian', accion: 'Ir al Centro DIAN' });
    }
    const critico90 = D(cartera.buckets?.d90mas);
    if (critico90 > 0) {
      a.push({ clave: 'cartera_90', severidad: 'critica', titulo: 'Cartera crítica +90 días', detalle: `${money(critico90)} con más de 90 días. Candidata a acuerdo de pago o castigo.`, tab: 'acuerdos', accion: 'Gestionar cartera' });
    }

    // --- Atención ---
    if (dash.utilidadNeta < 0) {
      a.push({ clave: 'perdida', severidad: 'atencion', titulo: 'Resultado del periodo en pérdida', detalle: `Utilidad neta ${money(dash.utilidadNeta)} (ingresos ${money(dash.ingresos)} vs gastos ${money(dash.gastos)}).`, tab: 'reportes', accion: 'Ver estado de resultados' });
    }
    if (comprasVencidas > 0) {
      a.push({ clave: 'cxp_vencidas', severidad: 'atencion', titulo: 'Facturas de proveedor vencidas', detalle: `${comprasVencidas} compra(s) vencida(s) por ${money(comprasVencidasMonto)}.`, tab: 'compras', accion: 'Ir a Compras / CxP' });
    }
    const borr = item('borradores');
    if (borr && borr.estado !== 'ok') {
      a.push({ clave: 'borradores', severidad: 'atencion', titulo: 'Comprobantes en borrador', detalle: borr.detalle, tab: 'asientos', accion: 'Ver comprobantes' });
    }
    const banco = item('banco');
    if (banco && banco.estado !== 'ok') {
      a.push({ clave: 'sin_conciliar', severidad: 'atencion', titulo: 'Conciliación bancaria pendiente', detalle: banco.detalle, tab: 'bancos', accion: 'Conciliar bancos' });
    }
    if (recibosHuerfanos > 0) {
      a.push({ clave: 'recibos_huerfanos', severidad: 'atencion', titulo: 'Recibos sin identificar', detalle: `${recibosHuerfanos} recibo(s) de caja sin cliente asignado.`, tab: 'recibos', accion: 'Identificar recibos' });
    }
    if (activos.sinCapitalizar > 0) {
      a.push({ clave: 'sin_capitalizar', severidad: 'atencion', titulo: 'Equipos sin capitalizar', detalle: `${activos.sinCapitalizar} equipo(s) de red con costo y sin activo fijo contable vinculado.`, tab: 'inventario', accion: 'Ver inventario de red' });
    }
    const nom = item('nomina');
    if (nom && nom.estado !== 'ok') {
      a.push({ clave: 'nomina', severidad: 'atencion', titulo: 'Nómina del periodo pendiente', detalle: nom.detalle, tab: 'nomina', accion: 'Liquidar nómina' });
    }
    const dep = item('depreciacion');
    if (dep && dep.estado !== 'ok') {
      a.push({ clave: 'depreciacion', severidad: 'atencion', titulo: 'Depreciación del periodo pendiente', detalle: dep.detalle, tab: 'activos', accion: 'Correr depreciación' });
    }
    // Certificado de firma DIAN por vencer / vencido.
    if (dianCfg?.certificadoVence) {
      const dias = this.diasHasta(new Date(dianCfg.certificadoVence));
      if (dias < 0) a.push({ clave: 'cert_vencido', severidad: 'critica', titulo: 'Certificado de firma vencido', detalle: `El certificado venció hace ${Math.abs(dias)} día(s). No se puede emitir a la DIAN.`, tab: 'dian', accion: 'Renovar certificado' });
      else if (dias <= 30) a.push({ clave: 'cert_por_vencer', severidad: 'atencion', titulo: 'Certificado de firma por vencer', detalle: `El certificado vence en ${dias} día(s) (${dianCfg.certificadoVence}).`, tab: 'dian', accion: 'Renovar certificado' });
    }

    // --- Indicadores de riesgo (info) ---
    if (t.totalActivo > 0) {
      const endeudamiento = t.totalPasivo / t.totalActivo;
      if (endeudamiento > 0.7) a.push({ clave: 'endeudamiento', severidad: 'info', titulo: 'Endeudamiento elevado', detalle: `El pasivo representa el ${(endeudamiento * 100).toFixed(0)}% del activo.`, tab: 'reportes', accion: 'Ver situación financiera' });
    }
    if (t.pasivoCorriente > 0) {
      const razon = t.activoCorriente / t.pasivoCorriente;
      if (razon < 1) a.push({ clave: 'liquidez', severidad: 'info', titulo: 'Liquidez ajustada', detalle: `Razón corriente ${razon.toFixed(2)}: el activo corriente no cubre el pasivo corriente.`, tab: 'reportes', accion: 'Ver situación financiera' });
    }

    return a.sort((x, y) => ORDEN_SEVERIDAD[x.severidad] - ORDEN_SEVERIDAD[y.severidad]);
  }

  // ---- Indicadores de salud financiera ----
  private construirIndicadores(ctx: { dash: { ingresos: number; utilidadNeta: number; cartera: number; bancosCaja: number }; t: any }): Indicador[] {
    const { dash, t } = ctx;
    const ind: Indicador[] = [];

    // Razón corriente (liquidez): activo corriente / pasivo corriente.
    if (t.pasivoCorriente > 0) {
      const r = t.activoCorriente / t.pasivoCorriente;
      ind.push({ clave: 'razon_corriente', titulo: 'Razón corriente', valor: r.toFixed(2), estado: r >= 1.5 ? 'bueno' : r >= 1 ? 'alerta' : 'malo', ayuda: 'Activo corriente / pasivo corriente. Ideal ≥ 1.5', tab: 'reportes' });
    } else {
      ind.push({ clave: 'razon_corriente', titulo: 'Razón corriente', valor: 'N/D', estado: 'neutro', ayuda: 'Sin pasivo corriente registrado', tab: 'reportes' });
    }

    // Capital de trabajo.
    const capital = round2(t.activoCorriente - t.pasivoCorriente);
    ind.push({ clave: 'capital_trabajo', titulo: 'Capital de trabajo', valor: money(capital), estado: capital > 0 ? 'bueno' : 'malo', ayuda: 'Activo corriente − pasivo corriente', tab: 'reportes' });

    // Endeudamiento.
    if (t.totalActivo > 0) {
      const e = t.totalPasivo / t.totalActivo;
      ind.push({ clave: 'endeudamiento', titulo: 'Endeudamiento', valor: `${(e * 100).toFixed(0)}%`, estado: e <= 0.6 ? 'bueno' : e <= 0.7 ? 'alerta' : 'malo', ayuda: 'Pasivo total / activo total. Ideal ≤ 60%', tab: 'reportes' });
    } else {
      ind.push({ clave: 'endeudamiento', titulo: 'Endeudamiento', valor: 'N/D', estado: 'neutro', ayuda: 'Sin activos registrados', tab: 'reportes' });
    }

    // Margen neto.
    if (dash.ingresos > 0) {
      const m = dash.utilidadNeta / dash.ingresos;
      ind.push({ clave: 'margen_neto', titulo: 'Margen neto', valor: `${(m * 100).toFixed(1)}%`, estado: m >= 0.1 ? 'bueno' : m >= 0 ? 'alerta' : 'malo', ayuda: 'Utilidad neta / ingresos del periodo', tab: 'reportes' });
    } else {
      ind.push({ clave: 'margen_neto', titulo: 'Margen neto', valor: 'N/D', estado: 'neutro', ayuda: 'Sin ingresos en el periodo', tab: 'reportes' });
    }

    // Rotación de cartera (DSO aprox.): días promedio de recaudo.
    if (dash.ingresos > 0 && dash.cartera > 0) {
      const dso = (dash.cartera / dash.ingresos) * 30;
      ind.push({ clave: 'dso', titulo: 'Días de cartera (DSO)', valor: `${Math.round(dso)} d`, estado: dso <= 30 ? 'bueno' : dso <= 45 ? 'alerta' : 'malo', ayuda: 'Cartera / ingresos × 30. Mide qué tan rápido cobra', tab: 'cartera' });
    } else if (dash.ingresos > 0) {
      ind.push({ clave: 'dso', titulo: 'Días de cartera (DSO)', valor: '0 d', estado: 'bueno', ayuda: 'Sin cartera neta por cobrar', tab: 'cartera' });
    } else {
      ind.push({ clave: 'dso', titulo: 'Días de cartera (DSO)', valor: 'N/D', estado: 'neutro', ayuda: 'Sin ingresos en el periodo', tab: 'cartera' });
    }

    // Liquidez inmediata: disponible / pasivo corriente.
    if (t.pasivoCorriente > 0) {
      const li = dash.bancosCaja / t.pasivoCorriente;
      ind.push({ clave: 'liquidez_inmediata', titulo: 'Liquidez inmediata', valor: li.toFixed(2), estado: li >= 0.5 ? 'bueno' : li >= 0.2 ? 'alerta' : 'malo', ayuda: 'Disponible (bancos y caja) / pasivo corriente', tab: 'tesoreria' });
    } else {
      ind.push({ clave: 'liquidez_inmediata', titulo: 'Liquidez inmediata', valor: 'N/D', estado: 'neutro', ayuda: 'Sin pasivo corriente registrado', tab: 'tesoreria' });
    }

    return ind;
  }

  // ---- Calendario tributario ----
  private diasHasta(fecha: Date): number {
    const hoy = new Date();
    const a = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
    const b = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
    return Math.round((b - a) / 86400000);
  }

  private severidadVencimiento(dias: number): Severidad {
    if (dias <= 3) return 'critica';
    if (dias <= 10) return 'atencion';
    return 'info';
  }

  /**
   * Calendario de obligaciones recurrentes. Las fechas son de REFERENCIA: la fecha
   * legal exacta depende del calendario tributario anual de la DIAN y del último
   * dígito del NIT. El contador confirma contra el calendario oficial.
   */
  private calendarioTributario(hoy: Date, dianCfg: any): { nota: string; obligaciones: ObligacionTributaria[] } {
    const y = hoy.getUTCFullYear();
    const m = hoy.getUTCMonth(); // 0-11
    const at = (year: number, monthIdx: number, day: number) => new Date(Date.UTC(year, monthIdx, day));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // Próxima ocurrencia mensual el día `day` (este mes si no ha pasado, si no el siguiente).
    const proximaMensual = (day: number) => {
      let d = at(y, m, day);
      if (this.diasHasta(d) < 0) d = at(y, m + 1, day);
      return d;
    };
    // Próximo cierre de bimestre + offset de días para declarar.
    const proximaBimestral = (offsetDia: number) => {
      // Bimestres terminan en feb, abr, jun, ago, oct, dic → declarar el mes siguiente.
      for (let i = 0; i < 12; i++) {
        const finBimestreMes = Math.floor((m + i) / 2) * 2 + 1; // 1,3,5,7,9,11 (mes de cierre, 0-idx)
        const d = at(y, finBimestreMes + 1, offsetDia);
        if (this.diasHasta(d) >= 0) return d;
      }
      return at(y + 1, 1, offsetDia);
    };

    const obligaciones: ObligacionTributaria[] = [];
    const push = (clave: string, titulo: string, fecha: Date, detalle: string, tab: string) => {
      const dias = this.diasHasta(fecha);
      obligaciones.push({ clave, titulo, fecha: fmt(fecha), diasRestantes: dias, severidad: this.severidadVencimiento(dias), detalle, tab });
    };

    push('retefuente', 'Retención en la fuente', proximaMensual(10), 'Declaración y pago mensual', 'compras');
    push('iva', 'IVA (bimestral)', proximaBimestral(12), 'Declaración bimestral de IVA', 'dian');
    push('ica', 'ICA Medellín (bimestral)', proximaBimestral(20), 'Industria y comercio bimestral', 'dian');
    push('nomina_e', 'Nómina electrónica', proximaMensual(10), 'Documento soporte de nómina del mes anterior', 'nomina');
    push('exogena', 'Información exógena', at(y + 1, 3, 30), `Medios magnéticos año gravable ${y}`, 'exogena');

    if (dianCfg?.certificadoVence) {
      const d = new Date(dianCfg.certificadoVence);
      if (!Number.isNaN(d.getTime())) push('cert', 'Vence certificado de firma', d, 'Renovación ante el proveedor tecnológico', 'dian');
    }

    obligaciones.sort((a, b) => a.diasRestantes - b.diasRestantes);
    return {
      nota: 'Fechas de referencia. La fecha legal exacta depende del calendario DIAN del año y del último dígito del NIT.',
      obligaciones,
    };
  }
}
