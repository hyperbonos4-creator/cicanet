import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { expandirPUC } from './puc-seed';

/** Una línea de asiento a registrar. */
export interface LineaInput {
  cuenta: string; // código PUC
  debito?: number;
  credito?: number;
  descripcion?: string;
  terceroId?: string;
  centroCosto?: string;
}

export interface AsientoInput {
  fecha?: string | Date;
  tipo?: string;
  descripcion: string;
  referenciaTipo?: string;
  referenciaId?: string;
  lineas: LineaInput[];
  /** Si true, se contabiliza de una vez; si false, queda en borrador. */
  contabilizar?: boolean;
  creadoPor?: string;
  /** Trazabilidad ampliada (Fase B). */
  sourceModule?: string;
  evento?: string;
  autoGenerado?: boolean;
  napId?: string;
  zonaId?: string;
  servicioId?: string;
  clienteId?: string;
  dianDocumentoId?: string;
}

const TIPOS = ['manual', 'apertura', 'venta', 'recaudo', 'compra', 'gasto', 'ajuste', 'depreciacion', 'cierre', 'reversion'];

/**
 * Prefijo de consecutivo por tipo de comprobante (numeración independiente):
 * RC=Recibo de Caja, CE=Comprobante de Egreso, CC=Comprobante de Compra,
 * NC=Nota de Contabilidad, FV=Factura de Venta, AP=Apertura, CIE=Cierre, RV=Reversión.
 */
const PREFIJO_COMPROBANTE: Record<string, string> = {
  manual: 'NC',
  apertura: 'AP',
  venta: 'FV',
  recaudo: 'RC',
  compra: 'CC',
  gasto: 'CE',
  ajuste: 'NC',
  depreciacion: 'NC',
  cierre: 'CIE',
  reversion: 'RV',
};
const D = (n: number | Prisma.Decimal | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Núcleo contable de doble partida (PUC Colombia). Garantiza:
 * - Cuadre exacto (Σ débitos == Σ créditos) por asiento.
 * - Escritura atómica (asiento + movimientos en una transacción).
 * - Inmutabilidad: un asiento contabilizado no se edita; se REVERSA.
 * - Bloqueo de periodo cerrado.
 * - Validación de cuentas imputables y requisitos (tercero/centro de costo).
 */
@Injectable()
export class AccountingService implements OnModuleInit {
  private readonly logger = new Logger('AccountingService');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedPUC();
  }

  /** Siembra el PUC base si la tabla está vacía (idempotente). */
  async seedPUC() {
    const count = await this.prisma.cuentaContable.count();
    if (count > 0) return;
    const cuentas = expandirPUC();
    await this.prisma.cuentaContable.createMany({
      data: cuentas.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        clase: c.clase,
        naturaleza: c.naturaleza,
        nivel: c.nivel,
        padreCodigo: c.padreCodigo,
        imputable: c.imputable,
        exigeTercero: c.exigeTercero,
        exigeCentro: c.exigeCentro,
      })),
      skipDuplicates: true,
    });
    this.logger.log(`PUC sembrado: ${cuentas.length} cuentas.`);
  }

  // ---- Plan de cuentas ----

  listCuentas(filtro: { q?: string; soloImputables?: boolean; clase?: number } = {}) {
    const where: Prisma.CuentaContableWhereInput = { activa: true };
    if (filtro.soloImputables) where.imputable = true;
    if (filtro.clase) where.clase = filtro.clase;
    if (filtro.q) {
      where.OR = [
        { codigo: { startsWith: filtro.q } },
        { nombre: { contains: filtro.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.cuentaContable.findMany({ where, orderBy: { codigo: 'asc' }, take: 1000 });
  }

  async crearCuenta(input: { codigo: string; nombre: string; imputable?: boolean; exigeTercero?: boolean; exigeCentro?: boolean }) {
    const codigo = input.codigo.trim();
    if (!/^\d{1,10}$/.test(codigo)) throw new BadRequestException('El código de cuenta debe ser numérico (PUC).');
    const existe = await this.prisma.cuentaContable.findUnique({ where: { codigo } });
    if (existe) throw new ConflictException('Ya existe una cuenta con ese código.');
    const clase = parseInt(codigo[0], 10);
    const { naturalezaDeClase, nivelDeCodigo, padreDeCodigo } = await import('./puc-seed');
    return this.prisma.cuentaContable.create({
      data: {
        codigo,
        nombre: input.nombre.trim(),
        clase,
        naturaleza: naturalezaDeClase(clase),
        nivel: nivelDeCodigo(codigo),
        padreCodigo: padreDeCodigo(codigo),
        imputable: input.imputable ?? codigo.length >= 6,
        exigeTercero: !!input.exigeTercero,
        exigeCentro: !!input.exigeCentro,
      },
    });
  }

  // ---- Periodos ----

  periodoDe(fecha: Date): string {
    return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async asegurarPeriodoAbierto(periodo: string) {
    const p = await this.prisma.periodoContable.findUnique({ where: { periodo } });
    if (!p) {
      await this.prisma.periodoContable.create({ data: { periodo, estado: 'abierto' } });
      return;
    }
    if (p.estado === 'cerrado') {
      throw new ConflictException(`El periodo ${periodo} está cerrado. No se pueden registrar asientos.`);
    }
  }

  listPeriodos() {
    return this.prisma.periodoContable.findMany({ orderBy: { periodo: 'desc' }, take: 36 });
  }

  async cerrarPeriodo(periodo: string, actor?: string) {
    const borradores = await this.prisma.asientoContable.count({ where: { periodo, estado: 'borrador' } });
    if (borradores > 0) {
      throw new ConflictException(`No se puede cerrar: hay ${borradores} asiento(s) en borrador en ${periodo}.`);
    }
    await this.prisma.periodoContable.upsert({
      where: { periodo },
      update: { estado: 'cerrado', cerradoPor: actor, cerradoEn: new Date() },
      create: { periodo, estado: 'cerrado', cerradoPor: actor, cerradoEn: new Date() },
    });
    return { periodo, estado: 'cerrado' };
  }

  async reabrirPeriodo(periodo: string) {
    await this.prisma.periodoContable.update({ where: { periodo }, data: { estado: 'abierto', cerradoPor: null, cerradoEn: null } });
    return { periodo, estado: 'abierto' };
  }

  /**
   * Checklist de pre-cierre: valida que el periodo esté listo para cerrar.
   * `error` bloquea el cierre; `warn` solo advierte. (cerrarPeriodo bloquea borradores).
   */
  async checklistCierre(periodo: string) {
    const [borradores, movs, recibos, sinConciliar, empleados, liquidaciones, activos, depreciaciones] = await Promise.all([
      this.prisma.asientoContable.count({ where: { periodo, estado: 'borrador' } }),
      this.prisma.movimientoContable.aggregate({ _sum: { debito: true, credito: true }, where: { asiento: { periodo, estado: 'contabilizado' } } }),
      this.prisma.reciboCaja.count({ where: { estado: { in: ['sin_aplicar', 'parcial'] } } }),
      this.prisma.movimientoBancario.count({ where: { estado: 'sin_conciliar' } }),
      this.prisma.empleado.count({ where: { estado: 'activo' } }),
      this.prisma.liquidacionNomina.count({ where: { periodo } }),
      this.prisma.activoFijo.count({ where: { estado: 'activo' } }),
      this.prisma.depreciacionRegistro.count({ where: { periodo } }),
    ]);
    const debito = round2(D(movs._sum.debito));
    const credito = round2(D(movs._sum.credito));
    const cuadra = debito === credito;
    const nominaPend = Math.max(0, empleados - liquidaciones);
    const depPend = depreciaciones === 0 && activos > 0;

    const items = [
      { clave: 'borradores', titulo: 'Comprobantes en borrador', estado: borradores > 0 ? 'error' : 'ok', detalle: borradores > 0 ? `${borradores} sin contabilizar` : 'Todos contabilizados' },
      { clave: 'cuadre', titulo: 'Partida doble cuadrada', estado: cuadra ? 'ok' : 'error', detalle: cuadra ? `D=C=${debito.toLocaleString('es-CO')}` : `Descuadre: ${(debito - credito).toLocaleString('es-CO')}` },
      { clave: 'recibos', titulo: 'Recibos de caja por aplicar', estado: recibos > 0 ? 'warn' : 'ok', detalle: recibos > 0 ? `${recibos} pendiente(s)` : 'Todos aplicados' },
      { clave: 'banco', titulo: 'Conciliación bancaria', estado: sinConciliar > 0 ? 'warn' : 'ok', detalle: sinConciliar > 0 ? `${sinConciliar} movimiento(s) sin conciliar` : 'Conciliado' },
      { clave: 'nomina', titulo: 'Nómina del periodo', estado: nominaPend > 0 ? 'warn' : 'ok', detalle: nominaPend > 0 ? `${nominaPend} empleado(s) sin liquidar` : 'Liquidada' },
      { clave: 'depreciacion', titulo: 'Depreciación del periodo', estado: depPend ? 'warn' : 'ok', detalle: depPend ? 'Pendiente de correr' : 'Corrida' },
    ];
    const bloqueantes = items.filter((i) => i.estado === 'error').length;
    return { periodo, puedeCerrar: bloqueantes === 0, bloqueantes, items };
  }

  // ---- Asientos ----

  /** Crea (y opcionalmente contabiliza) un asiento de doble partida. */
  async crearAsiento(input: AsientoInput) {
    const fecha = input.fecha ? new Date(input.fecha) : new Date();
    if (Number.isNaN(fecha.getTime())) throw new BadRequestException('Fecha inválida.');
    const periodo = this.periodoDe(fecha);
    const tipo = TIPOS.includes(String(input.tipo)) ? String(input.tipo) : 'manual';

    if (!input.descripcion || input.descripcion.trim().length < 3) {
      throw new BadRequestException('La descripción del comprobante es obligatoria.');
    }
    if (!Array.isArray(input.lineas) || input.lineas.length < 2) {
      throw new BadRequestException('Un asiento requiere al menos dos movimientos (débito y crédito).');
    }

    // Validar cuentas y montos.
    const codigos = [...new Set(input.lineas.map((l) => l.cuenta))];
    const cuentas = await this.prisma.cuentaContable.findMany({ where: { codigo: { in: codigos } } });
    const byCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

    let debitoTotal = 0;
    let creditoTotal = 0;
    const movimientos: Prisma.MovimientoContableCreateManyAsientoInput[] = [];
    let orden = 0;

    for (const l of input.lineas) {
      const cuenta = byCodigo.get(l.cuenta);
      if (!cuenta) throw new BadRequestException(`La cuenta ${l.cuenta} no existe en el PUC.`);
      if (!cuenta.imputable) throw new BadRequestException(`La cuenta ${l.cuenta} (${cuenta.nombre}) es de título; no admite movimientos. Usa una cuenta auxiliar.`);
      if (!cuenta.activa) throw new BadRequestException(`La cuenta ${l.cuenta} está inactiva.`);

      const debito = round2(D(l.debito));
      const credito = round2(D(l.credito));
      if (debito < 0 || credito < 0) throw new BadRequestException('Los valores no pueden ser negativos.');
      if (debito > 0 && credito > 0) throw new BadRequestException(`La línea de ${l.cuenta} no puede tener débito y crédito a la vez.`);
      if (debito === 0 && credito === 0) throw new BadRequestException(`La línea de ${l.cuenta} debe tener débito o crédito.`);
      if (cuenta.exigeTercero && !l.terceroId) throw new BadRequestException(`La cuenta ${l.cuenta} exige un tercero.`);
      if (cuenta.exigeCentro && !l.centroCosto) throw new BadRequestException(`La cuenta ${l.cuenta} exige centro de costo.`);

      debitoTotal = round2(debitoTotal + debito);
      creditoTotal = round2(creditoTotal + credito);
      movimientos.push({
        cuentaCodigo: l.cuenta,
        descripcion: l.descripcion?.slice(0, 300) ?? null,
        debito,
        credito,
        terceroId: l.terceroId ?? null,
        centroCosto: l.centroCosto ?? null,
        orden: orden++,
      });
    }

    if (debitoTotal !== creditoTotal) {
      throw new BadRequestException(
        `El asiento no cuadra: débitos ${debitoTotal.toLocaleString('es-CO')} ≠ créditos ${creditoTotal.toLocaleString('es-CO')}.`,
      );
    }
    if (debitoTotal === 0) throw new BadRequestException('El asiento no puede ser por valor cero.');

    const contabilizar = input.contabilizar !== false;
    if (contabilizar) await this.asegurarPeriodoAbierto(periodo);
    else await this.prisma.periodoContable.upsert({ where: { periodo }, update: {}, create: { periodo } });

    const numero = await this.siguienteNumero(tipo);
    const asiento = await this.prisma.asientoContable.create({
      data: {
        numero,
        fecha,
        periodo,
        tipo,
        descripcion: input.descripcion.trim().slice(0, 500),
        referenciaTipo: input.referenciaTipo ?? null,
        referenciaId: input.referenciaId ?? null,
        sourceModule: input.sourceModule ?? null,
        evento: input.evento ?? null,
        autoGenerado: input.autoGenerado ?? false,
        napId: input.napId ?? null,
        zonaId: input.zonaId ?? null,
        servicioId: input.servicioId ?? null,
        clienteId: input.clienteId ?? null,
        dianDocumentoId: input.dianDocumentoId ?? null,
        estado: contabilizar ? 'contabilizado' : 'borrador',
        debitoTotal,
        creditoTotal,
        creadoPor: input.creadoPor ?? null,
        contabilizadoPor: contabilizar ? input.creadoPor ?? null : null,
        contabilizadoEn: contabilizar ? new Date() : null,
        movimientos: { createMany: { data: movimientos } },
      },
      include: { movimientos: true },
    });
    return asiento;
  }

  private async siguienteNumero(tipo = 'manual'): Promise<string> {
    const prefijo = PREFIJO_COMPROBANTE[tipo] ?? 'CMP';
    const count = await this.prisma.asientoContable.count({ where: { numero: { startsWith: `${prefijo}-` } } });
    return `${prefijo}-${String(count + 1).padStart(6, '0')}`;
  }

  /** Contabiliza un asiento en borrador (valida periodo abierto). */
  async contabilizar(id: string, actor?: string) {
    const a = await this.prisma.asientoContable.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Asiento no encontrado.');
    if (a.estado !== 'borrador') throw new ConflictException('Solo se contabilizan asientos en borrador.');
    await this.asegurarPeriodoAbierto(a.periodo);
    return this.prisma.asientoContable.update({
      where: { id },
      data: { estado: 'contabilizado', contabilizadoPor: actor ?? null, contabilizadoEn: new Date() },
    });
  }

  /**
   * Reversa un asiento contabilizado (inmutabilidad): crea uno nuevo con
   * débitos/créditos invertidos y marca ambos como anulados/reversados.
   */
  async reversar(id: string, actor?: string) {
    const original = await this.prisma.asientoContable.findUnique({ where: { id }, include: { movimientos: true } });
    if (!original) throw new NotFoundException('Asiento no encontrado.');
    if (original.estado !== 'contabilizado') throw new ConflictException('Solo se reversan asientos contabilizados.');
    await this.asegurarPeriodoAbierto(this.periodoDe(new Date()));

    const numero = await this.siguienteNumero('reversion');
    const reverso = await this.prisma.asientoContable.create({
      data: {
        numero,
        fecha: new Date(),
        periodo: this.periodoDe(new Date()),
        tipo: 'reversion',
        descripcion: `Reversión de ${original.numero}: ${original.descripcion}`.slice(0, 500),
        referenciaTipo: original.referenciaTipo,
        referenciaId: original.referenciaId,
        sourceModule: original.sourceModule,
        evento: 'asiento.reversed',
        autoGenerado: original.autoGenerado,
        napId: original.napId,
        zonaId: original.zonaId,
        servicioId: original.servicioId,
        clienteId: original.clienteId,
        estado: 'contabilizado',
        debitoTotal: original.creditoTotal,
        creditoTotal: original.debitoTotal,
        reversaDeId: original.id,
        creadoPor: actor ?? null,
        contabilizadoPor: actor ?? null,
        contabilizadoEn: new Date(),
        movimientos: {
          createMany: {
            data: original.movimientos.map((m, i) => ({
              cuentaCodigo: m.cuentaCodigo,
              descripcion: `Reversión: ${m.descripcion ?? ''}`.slice(0, 300),
              debito: m.credito,
              credito: m.debito,
              terceroId: m.terceroId,
              centroCosto: m.centroCosto,
              orden: i,
            })),
          },
        },
      },
      include: { movimientos: true },
    });
    await this.prisma.asientoContable.update({ where: { id: original.id }, data: { estado: 'anulado' } });
    return reverso;
  }

  listAsientos(filtro: { periodo?: string; tipo?: string; estado?: string; sourceModule?: string; referenciaTipo?: string; referenciaId?: string } = {}) {
    const where: Prisma.AsientoContableWhereInput = {};
    if (filtro.periodo) where.periodo = filtro.periodo;
    if (filtro.tipo) where.tipo = filtro.tipo;
    if (filtro.estado) where.estado = filtro.estado;
    if (filtro.sourceModule) where.sourceModule = filtro.sourceModule;
    if (filtro.referenciaTipo) where.referenciaTipo = filtro.referenciaTipo;
    if (filtro.referenciaId) where.referenciaId = filtro.referenciaId;
    return this.prisma.asientoContable.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
      take: 200,
      include: { movimientos: { include: { cuenta: true, tercero: true }, orderBy: { orden: 'asc' } } },
    });
  }

  async getAsiento(id: string) {
    const a = await this.prisma.asientoContable.findUnique({
      where: { id },
      include: { movimientos: { include: { cuenta: true, tercero: true }, orderBy: { orden: 'asc' } } },
    });
    if (!a) throw new NotFoundException('Asiento no encontrado.');
    return a;
  }

  // ---- Terceros ----

  listTerceros(q?: string) {
    const where: Prisma.TerceroWhereInput = {};
    if (q) where.OR = [{ nombre: { contains: q, mode: 'insensitive' } }, { documento: { contains: q } }];
    return this.prisma.tercero.findMany({ where, orderBy: { nombre: 'asc' }, take: 100 });
  }

  async crearTercero(input: { documento: string; nombre: string; tipo?: string; tipoDocumento?: string; dv?: string; email?: string; telefono?: string; clienteId?: string }) {
    const documento = input.documento.trim();
    if (!documento) throw new BadRequestException('El documento es obligatorio.');
    const existe = await this.prisma.tercero.findUnique({ where: { documento } });
    if (existe) return existe;
    return this.prisma.tercero.create({
      data: {
        documento,
        nombre: input.nombre.trim(),
        tipo: input.tipo ?? 'cliente',
        tipoDocumento: input.tipoDocumento ?? 'CC',
        dv: input.dv ?? null,
        email: input.email ?? null,
        telefono: input.telefono ?? null,
        clienteId: input.clienteId ?? null,
      },
    });
  }
}
