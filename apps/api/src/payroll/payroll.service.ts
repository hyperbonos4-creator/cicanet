import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

interface NominaConfig {
  smmlv: number;            // salario mínimo mensual vigente
  auxilioTransporte: number; // valor del auxilio de transporte
  saludEmpleadoPct: number;  // 4
  pensionEmpleadoPct: number; // 4
}
const DEFAULTS: NominaConfig = { smmlv: 1623500, auxilioTransporte: 200000, saludEmpleadoPct: 4, pensionEmpleadoPct: 4 };

/** Cuentas PUC de nómina (se crean si faltan). */
const CUENTAS = { sueldos: '510506', salud: '237005', pension: '237006', porPagar: '250505' };

/**
 * Nómina: liquidación mensual (devengados − deducciones) y su contabilización.
 *   Dr 510506 Sueldos (devengado)  Cr 237005 salud + 237006 pensión + 250505 neto.
 * La emisión del documento de NÓMINA ELECTRÓNICA ante la DIAN se realiza vía el
 * microservicio einvoice (módulo `nomina` de facho) cuando haya certificados de
 * CICANET; hoy se deja la liquidación y el asiento listos.
 */
@Injectable()
export class PayrollService implements OnModuleInit {
  private readonly logger = new Logger('PayrollService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  /** Garantiza que existan las cuentas PUC de aportes de nómina. */
  async onModuleInit() {
    await this.asegurarCuenta(CUENTAS.salud, 'Aportes EPS (salud) por pagar');
    await this.asegurarCuenta(CUENTAS.pension, 'Aportes fondo de pensiones por pagar');
  }
  private async asegurarCuenta(codigo: string, nombre: string) {
    const existe = await this.prisma.cuentaContable.findUnique({ where: { codigo } });
    if (!existe) {
      try { await this.accounting.crearCuenta({ codigo, nombre, imputable: true }); } catch { /* ya existe / carrera */ }
    }
  }

  async getConfig(): Promise<NominaConfig> {
    const s = await this.prisma.setting.findUnique({ where: { clave: 'nomina_config' } });
    return { ...DEFAULTS, ...((s?.valor as any) ?? {}) };
  }
  async setConfig(cfg: Partial<NominaConfig>, actor?: string) {
    const merged = { ...(await this.getConfig()), ...cfg };
    await this.prisma.setting.upsert({ where: { clave: 'nomina_config' }, update: { valor: merged as any, actualizadoPor: actor }, create: { clave: 'nomina_config', valor: merged as any, actualizadoPor: actor } });
    return merged;
  }

  // ---- empleados ----
  listEmpleados() {
    return this.prisma.empleado.findMany({ orderBy: { nombre: 'asc' } });
  }
  async crearEmpleado(input: { nombre: string; documento: string; cargo?: string; salarioBase: number; fechaIngreso?: string; email?: string }) {
    if (!input.nombre?.trim() || !input.documento?.trim()) throw new BadRequestException('Nombre y documento son obligatorios.');
    if (D(input.salarioBase) <= 0) throw new BadRequestException('El salario base debe ser mayor a cero.');
    return this.prisma.empleado.create({
      data: {
        nombre: input.nombre.trim(),
        documento: input.documento.trim(),
        cargo: input.cargo,
        salarioBase: round2(D(input.salarioBase)),
        fechaIngreso: input.fechaIngreso ? new Date(input.fechaIngreso) : new Date(),
        email: input.email,
      },
    });
  }

  /** Calcula la liquidación de un empleado (sin escribir). */
  private async calcular(empleado: { salarioBase: any }, cfg: NominaConfig) {
    const salario = round2(D(empleado.salarioBase));
    const auxilio = salario <= cfg.smmlv * 2 ? cfg.auxilioTransporte : 0;
    const totalDevengado = round2(salario + auxilio);
    const salud = round2(salario * cfg.saludEmpleadoPct / 100);
    const pension = round2(salario * cfg.pensionEmpleadoPct / 100);
    const totalDeducciones = round2(salud + pension);
    const neto = round2(totalDevengado - totalDeducciones);
    return {
      devengados: [{ concepto: 'Salario', valor: salario }, ...(auxilio > 0 ? [{ concepto: 'Auxilio de transporte', valor: auxilio }] : [])],
      deducciones: [{ concepto: 'Salud (4%)', valor: salud }, { concepto: 'Pensión (4%)', valor: pension }],
      totalDevengado, salud, pension, totalDeducciones, neto,
    };
  }

  /** Previsualiza la nómina del periodo (empleados activos sin liquidar). */
  async preview(periodo: string) {
    this.validarPeriodo(periodo);
    const cfg = await this.getConfig();
    const empleados = await this.prisma.empleado.findMany({ where: { estado: 'activo' }, include: { liquidaciones: { where: { periodo } } } });
    let totalNeto = 0, totalDevengado = 0;
    const items: any[] = [];
    for (const e of empleados) {
      if (e.liquidaciones.length > 0) continue;
      const c = await this.calcular(e, cfg);
      totalNeto = round2(totalNeto + c.neto);
      totalDevengado = round2(totalDevengado + c.totalDevengado);
      items.push({ empleado: e.nombre, cargo: e.cargo, ...c });
    }
    return { periodo, empleados: items.length, totalDevengado, totalNeto, items };
  }

  /** Liquida la nómina del periodo y la contabiliza. */
  async run(periodo: string, opts: { dryRun?: boolean; actor?: string } = {}) {
    this.validarPeriodo(periodo);
    if (opts.dryRun) return { dryRun: true, ...(await this.preview(periodo)) };
    const cfg = await this.getConfig();
    const [anio, mes] = periodo.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, 28));
    const empleados = await this.prisma.empleado.findMany({ where: { estado: 'activo' }, include: { liquidaciones: { where: { periodo } } } });

    let liquidados = 0;
    let totalNeto = 0;
    for (const e of empleados) {
      if (e.liquidaciones.length > 0) continue;
      const c = await this.calcular(e, cfg);
      try {
        const tercero = await this.accounting.crearTercero({ documento: e.documento, nombre: e.nombre, tipo: 'empleado', tipoDocumento: e.tipoDocumento });
        const asiento = await this.accounting.crearAsiento({
          fecha,
          tipo: 'gasto',
          descripcion: `Nómina ${periodo} - ${e.nombre}`,
          referenciaTipo: 'nomina',
          referenciaId: `${e.id}|${periodo}`,
          lineas: [
            { cuenta: CUENTAS.sueldos, debito: c.totalDevengado, descripcion: `Devengado ${e.nombre}` },
            { cuenta: CUENTAS.salud, credito: c.salud, descripcion: 'Salud 4%' },
            { cuenta: CUENTAS.pension, credito: c.pension, descripcion: 'Pensión 4%' },
            { cuenta: CUENTAS.porPagar, credito: c.neto, terceroId: tercero.id, descripcion: `Neto a pagar ${e.nombre}` },
          ],
          contabilizar: true,
          creadoPor: opts.actor,
        });
        await this.prisma.liquidacionNomina.create({
          data: {
            empleadoId: e.id, periodo,
            devengados: c.devengados as any, deducciones: c.deducciones as any,
            totalDevengado: c.totalDevengado, totalDeducciones: c.totalDeducciones, neto: c.neto,
            asientoId: asiento.id,
          },
        });
        liquidados++;
        totalNeto = round2(totalNeto + c.neto);
      } catch (e2: any) {
        if (e2?.code !== 'P2002') this.logger.warn(`Nómina ${e.nombre} falló: ${e2.message}`);
      }
    }
    return { dryRun: false, periodo, liquidados, totalNeto };
  }

  listLiquidaciones(periodo?: string) {
    return this.prisma.liquidacionNomina.findMany({ where: { periodo }, include: { empleado: true }, orderBy: { creadoEn: 'desc' }, take: 500 });
  }

  private validarPeriodo(periodo: string) {
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new BadRequestException('Periodo inválido (YYYY-MM).');
  }
}
