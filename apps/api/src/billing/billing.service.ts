import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

interface BillingConfig {
  diaCorte: number;          // día del mes de vencimiento por defecto
  ivaPorcentaje: number;     // IVA del servicio (residencial suele ser 0)
  diasGracia: number;        // días tras vencimiento antes de suspender
  cuentaIngreso: string;     // PUC ingreso
}

const DEFAULTS: BillingConfig = { diaCorte: 15, ivaPorcentaje: 0, diasGracia: 5, cuentaIngreso: '414505' };

/**
 * Facturación recurrente por ciclo: genera las facturas mensuales de los
 * servicios activos, las contabiliza en el ledger (Dr CxC, Cr Ingreso, Cr IVA)
 * y suspende por mora. Idempotente: una factura por (servicio, periodo) — el
 * índice único en BD lo garantiza. Best-effort: un fallo de cobro nunca revierte
 * el alta del cliente.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('BillingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  // ---- configuración ----
  async getConfig(): Promise<BillingConfig> {
    const s = await this.prisma.setting.findUnique({ where: { clave: 'billing_config' } });
    return { ...DEFAULTS, ...((s?.valor as any) ?? {}) };
  }
  async setConfig(cfg: Partial<BillingConfig>, actor?: string) {
    const merged = { ...(await this.getConfig()), ...cfg };
    await this.prisma.setting.upsert({
      where: { clave: 'billing_config' },
      update: { valor: merged as any, actualizadoPor: actor },
      create: { clave: 'billing_config', valor: merged as any, actualizadoPor: actor },
    });
    return merged;
  }

  // ---- utilidades de periodo ----
  private validarPeriodo(periodo: string): { anio: number; mes: number } {
    const m = /^(\d{4})-(\d{2})$/.exec(periodo);
    if (!m) throw new BadRequestException('Periodo inválido. Usa formato YYYY-MM.');
    const anio = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    if (mes < 1 || mes > 12) throw new BadRequestException('Mes inválido.');
    return { anio, mes };
  }
  private diasDelMes(anio: number, mes: number) { return new Date(anio, mes, 0).getDate(); }

  /** Calcula el cobro de un servicio para el periodo (con prorrateo si aplica). */
  private calcularCobro(servicio: any, anio: number, mes: number, cfg: BillingConfig) {
    const tarifa = round2(D(servicio.tarifa));
    if (tarifa <= 0) return null; // sin tarifa => no se factura
    const diasMes = this.diasDelMes(anio, mes);
    let dias = diasMes;
    let prorrateo = false;
    // Prorrateo si la instalación cae dentro del periodo facturado.
    if (servicio.fechaInstalacion) {
      const fi = new Date(servicio.fechaInstalacion);
      if (fi.getUTCFullYear() === anio && fi.getUTCMonth() + 1 === mes) {
        dias = diasMes - fi.getUTCDate() + 1;
        prorrateo = true;
      }
    }
    const subtotal = prorrateo ? round2((tarifa * dias) / diasMes) : tarifa;
    const iva = round2(subtotal * (cfg.ivaPorcentaje / 100));
    return { subtotal, iva, total: round2(subtotal + iva), dias, prorrateo };
  }

  /** Servicios facturables del periodo (activos, con tarifa, sin factura previa). */
  private async serviciosFacturables(periodo: string) {
    const servicios = await this.prisma.servicio.findMany({
      where: { estado: 'activo', cliente: { estado: { notIn: ['retirado'] } } },
      include: { cliente: { select: { id: true, codigo: true, nombre: true, documento: true } } },
    });
    const yaFacturados = await this.prisma.factura.findMany({
      where: { periodo, servicioId: { in: servicios.map((s) => s.id) } },
      select: { servicioId: true },
    });
    const set = new Set(yaFacturados.map((f) => f.servicioId));
    return servicios.filter((s) => !set.has(s.id));
  }

  /** Previsualiza la corrida sin escribir nada. */
  async preview(periodo: string) {
    this.validarPeriodo(periodo);
    const cfg = await this.getConfig();
    const { anio, mes } = this.validarPeriodo(periodo);
    const servicios = await this.serviciosFacturables(periodo);
    let totalAFacturar = 0;
    const items = servicios
      .map((s) => {
        const cobro = this.calcularCobro(s, anio, mes, cfg);
        if (!cobro) return null;
        totalAFacturar = round2(totalAFacturar + cobro.total);
        return { cliente: s.cliente.codigo + ' · ' + s.cliente.nombre, plan: s.planNombre, ...cobro };
      })
      .filter(Boolean);
    return { periodo, facturasAGenerar: items.length, totalAFacturar, items };
  }

  /** Ejecuta la facturación del periodo. dryRun=true no escribe. */
  async run(periodo: string, opts: { dryRun?: boolean; emitidoPor?: string } = {}) {
    const { anio, mes } = this.validarPeriodo(periodo);
    if (opts.dryRun) return { dryRun: true, ...(await this.preview(periodo)) };

    const cfg = await this.getConfig();
    const servicios = await this.serviciosFacturables(periodo);
    const fechaEmision = new Date(Date.UTC(anio, mes - 1, 1));
    const diaVenc = Math.min(cfg.diaCorte, this.diasDelMes(anio, mes));
    const fechaVencimiento = new Date(Date.UTC(anio, mes - 1, diaVenc));

    let generadas = 0;
    let contabilizadas = 0;
    let totalFacturado = 0;
    const errores: { cliente: string; error: string }[] = [];

    for (const s of servicios) {
      const cobro = this.calcularCobro(s, anio, mes, cfg);
      if (!cobro) continue;
      try {
        // 1) Crear factura (idempotente por índice único servicio+periodo).
        const factura = await this.prisma.factura.create({
          data: {
            servicioId: s.id,
            periodo,
            subtotal: cobro.subtotal,
            iva: cobro.iva,
            total: cobro.total,
            estado: 'pendiente',
            fechaEmision,
            fechaVencimiento,
          },
        });
        generadas++;
        totalFacturado = round2(totalFacturado + cobro.total);

        // 2) Contabilizar el ingreso (best-effort: si falla, la factura queda).
        try {
          const tercero = await this.accounting.crearTercero({
            documento: s.cliente.documento,
            nombre: s.cliente.nombre,
            tipo: 'cliente',
            clienteId: s.cliente.id,
          });
          const lineas: any[] = [
            { cuenta: '130505', debito: cobro.total, terceroId: tercero.id, descripcion: `CxC ${s.cliente.codigo} ${periodo}` },
            { cuenta: cfg.cuentaIngreso, credito: cobro.subtotal, descripcion: `Servicio internet ${periodo}` },
          ];
          if (cobro.iva > 0) lineas.push({ cuenta: '240805', credito: cobro.iva, descripcion: `IVA ${periodo}` });
          await this.accounting.crearAsiento({
            fecha: fechaEmision,
            tipo: 'venta',
            descripcion: `Facturación ${periodo} - ${s.cliente.nombre}`,
            referenciaTipo: 'factura',
            referenciaId: factura.id,
            lineas,
            contabilizar: true,
            creadoPor: opts.emitidoPor,
          });
          contabilizadas++;
        } catch (e: any) {
          this.logger.warn(`Factura ${factura.id} creada pero no contabilizada: ${e.message}`);
        }
      } catch (e: any) {
        // Choque de índice único (ya facturado) u otro error: registrar y seguir.
        if (e?.code !== 'P2002') errores.push({ cliente: s.cliente.codigo, error: e.message });
      }
    }

    return { periodo, dryRun: false, generadas, contabilizadas, totalFacturado, errores };
  }

  /** Marca vencidas las facturas pasadas de fecha y suspende a los morosos. */
  async suspenderMorosos(opts: { diasGracia?: number; aplicar?: boolean } = {}) {
    const cfg = await this.getConfig();
    const diasGracia = opts.diasGracia ?? cfg.diasGracia;
    const limite = new Date();
    limite.setUTCDate(limite.getUTCDate() - diasGracia);

    // Facturas vencidas más allá de la gracia, sin pagar.
    const vencidas = await this.prisma.factura.findMany({
      where: { estado: { in: ['pendiente', 'vencida'] }, fechaVencimiento: { lt: limite } },
      include: { servicio: { include: { cliente: true } } },
    });

    // Marcar 'vencida'.
    const idsVencer = vencidas.filter((f) => f.estado === 'pendiente').map((f) => f.id);
    if (opts.aplicar && idsVencer.length) {
      await this.prisma.factura.updateMany({ where: { id: { in: idsVencer } }, data: { estado: 'vencida' } });
    }

    // Servicios activos a suspender (tienen factura vencida pasada la gracia).
    const porServicio = new Map<string, { servicioId: string; clienteId: string; codigo: string; nombre: string }>();
    for (const f of vencidas) {
      const s = f.servicio;
      if (s.estado === 'activo') porServicio.set(s.id, { servicioId: s.id, clienteId: s.cliente.id, codigo: s.cliente.codigo, nombre: s.cliente.nombre });
    }
    const aSuspender = [...porServicio.values()];

    if (opts.aplicar && aSuspender.length) {
      await this.prisma.servicio.updateMany({ where: { id: { in: aSuspender.map((x) => x.servicioId) } }, data: { estado: 'suspendido' } });
      await this.prisma.cliente.updateMany({ where: { id: { in: aSuspender.map((x) => x.clienteId) } }, data: { estado: 'moroso' } });
    }

    return {
      aplicado: !!opts.aplicar,
      diasGracia,
      facturasVencidas: vencidas.length,
      marcadasVencidas: opts.aplicar ? idsVencer.length : 0,
      serviciosASuspender: aSuspender.length,
      detalle: aSuspender,
    };
  }
}
