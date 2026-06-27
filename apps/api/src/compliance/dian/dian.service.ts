import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ExogenaService } from '../exogena/exogena.service';

const CONFIG_KEY = 'dian_config';

interface DianConfig {
  nit: string | null;
  razonSocial: string | null;
  resolucion: string | null;
  rangoDesde: number | null;
  rangoHasta: number | null;
  prefijo: string | null;
  vigenciaHasta: string | null;
  certificadoVence: string | null;
  ambiente: 'habilitacion' | 'produccion';
  habilitado: boolean;
}

const CONFIG_DEFAULT: DianConfig = {
  nit: null, razonSocial: null, resolucion: null, rangoDesde: null, rangoHasta: null,
  prefijo: null, vigenciaHasta: null, certificadoVence: null, ambiente: 'habilitacion', habilitado: false,
};

/**
 * Centro DIAN unificado (Fase E): una sola vista del estado fiscal electrónico —
 * factura electrónica, notas, documento soporte, nómina electrónica y exógena —
 * más la configuración de certificado/resolución y un motor de mapeo
 * parametrizable (cuenta→concepto) con bandeja de validación pre-exportación.
 *
 * Lectura/operación contable: la verdad sigue siendo el ledger; aquí se gestiona
 * el ciclo fiscal (envío/aceptación/rechazo) y los reprocesos.
 */
@Injectable()
export class DianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exogena: ExogenaService,
  ) {}

  // ---- Configuración (certificado / resolución) ----

  async getConfig(): Promise<DianConfig> {
    const row = await this.prisma.setting.findUnique({ where: { clave: CONFIG_KEY } });
    return { ...CONFIG_DEFAULT, ...((row?.valor as any) ?? {}) };
  }

  async setConfig(patch: Partial<DianConfig>): Promise<DianConfig> {
    const actual = await this.getConfig();
    const valor = { ...actual, ...patch };
    await this.prisma.setting.upsert({
      where: { clave: CONFIG_KEY },
      update: { valor: valor as any },
      create: { clave: CONFIG_KEY, valor: valor as any },
    });
    return valor;
  }

  // ---- Centro: resumen agregado ----

  async centro() {
    const [porTipo, porEstado, nominaPend, config] = await Promise.all([
      this.prisma.dianDocumento.groupBy({ by: ['tipo'], _count: { _all: true }, _sum: { total: true } }),
      this.prisma.dianDocumento.groupBy({ by: ['estado'], _count: { _all: true } }),
      this.prisma.liquidacionNomina.count({ where: { documentoElectronico: false } }),
      this.getConfig(),
    ]);

    const estados = Object.fromEntries(porEstado.map((e) => [e.estado, e._count._all]));
    const rechazadas = (estados['rechazada'] ?? 0) + (estados['error'] ?? 0);

    // Estado de la habilitación (lo que falta para emitir en vivo).
    const habilitacion = [
      { clave: 'certificado', titulo: 'Certificado de firma', ok: !!config.certificadoVence, detalle: config.certificadoVence ? `Vence ${config.certificadoVence}` : 'Pendiente (externo)' },
      { clave: 'resolucion', titulo: 'Resolución de numeración', ok: !!config.resolucion, detalle: config.resolucion ?? 'Pendiente (externo)' },
      { clave: 'rango', titulo: 'Rango de numeración', ok: config.rangoDesde != null && config.rangoHasta != null, detalle: config.rangoDesde != null ? `${config.prefijo ?? ''}${config.rangoDesde}–${config.rangoHasta}` : 'Sin configurar' },
      { clave: 'produccion', titulo: 'Ambiente de producción', ok: config.ambiente === 'produccion' && config.habilitado, detalle: config.habilitado ? config.ambiente : 'En habilitación' },
    ];

    return {
      documentos: {
        porTipo: porTipo.map((t) => ({ tipo: t.tipo, cantidad: t._count._all, total: Number(t._sum.total ?? 0) })),
        porEstado: estados,
        rechazadas,
      },
      nominaElectronica: { pendientes: nominaPend },
      exogena: { formatos: this.exogena.formatos() },
      habilitacion,
      puedeEmitirEnVivo: habilitacion.every((h) => h.ok),
    };
  }

  // ---- Documentos DIAN ----

  listDocumentos(filtro: { tipo?: string; estado?: string } = {}) {
    return this.prisma.dianDocumento.findMany({
      where: { tipo: filtro.tipo, estado: filtro.estado },
      orderBy: { creadoEn: 'desc' },
      take: 300,
    });
  }

  /** Reprocesar: marca un documento rechazado/error para reintento (estado pendiente). */
  async reprocesar(id: string) {
    const doc = await this.prisma.dianDocumento.findUnique({ where: { id } });
    if (!doc) throw new BadRequestException('Documento no encontrado.');
    if (!['rechazada', 'error'].includes(doc.estado)) {
      throw new BadRequestException('Solo se reprocesan documentos rechazados o con error.');
    }
    return this.prisma.dianDocumento.update({ where: { id }, data: { estado: 'pendiente', mensajes: undefined } });
  }

  // ---- Motor de mapeo exógena (cuenta → concepto DIAN) ----

  listReglas(formato?: string) {
    return this.prisma.reglaExogena.findMany({ where: { formato }, orderBy: [{ formato: 'asc' }, { cuentaPatron: 'asc' }] });
  }

  upsertRegla(body: { formato: string; cuentaPatron: string; concepto: string; descripcion?: string; activa?: boolean }) {
    if (!/^\d{4}$/.test(body.formato)) throw new BadRequestException('Formato inválido (ej. 1001).');
    if (!/^\d{2,10}$/.test(body.cuentaPatron)) throw new BadRequestException('El patrón de cuenta debe ser numérico (PUC).');
    return this.prisma.reglaExogena.upsert({
      where: { formato_cuentaPatron: { formato: body.formato, cuentaPatron: body.cuentaPatron } },
      update: { concepto: body.concepto, descripcion: body.descripcion ?? null, activa: body.activa ?? true },
      create: { formato: body.formato, cuentaPatron: body.cuentaPatron, concepto: body.concepto, descripcion: body.descripcion ?? null, activa: body.activa ?? true },
    });
  }

  // ---- Bandeja de validación pre-exportación ----

  /**
   * Valida la calidad de los terceros y el mapeo antes de exportar exógena:
   * NITs con DV faltante, terceros sin tipo de documento y conteo de reglas de
   * mapeo configuradas por formato. Es el "semáforo" previo a presentar.
   */
  async validacion(anio: number) {
    const [terceros, reglas] = await Promise.all([
      this.prisma.tercero.findMany({ take: 5000 }),
      this.prisma.reglaExogena.count({ where: { activa: true } }),
    ]);

    const nitSinDv = terceros.filter((t) => t.tipoDocumento === 'NIT' && !t.dv);
    const sinTipoDoc = terceros.filter((t) => !t.tipoDocumento);
    const docInvalido = terceros.filter((t) => !/^\d{5,15}$/.test(t.documento.replace(/[.\-\s]/g, '')));

    const items = [
      { clave: 'nit_sin_dv', titulo: 'NIT sin dígito de verificación', estado: nitSinDv.length ? 'warn' : 'ok', cantidad: nitSinDv.length, muestra: nitSinDv.slice(0, 10).map((t) => t.nombre) },
      { clave: 'sin_tipo_doc', titulo: 'Tercero sin tipo de documento', estado: sinTipoDoc.length ? 'error' : 'ok', cantidad: sinTipoDoc.length, muestra: sinTipoDoc.slice(0, 10).map((t) => t.nombre) },
      { clave: 'doc_invalido', titulo: 'Documento con formato inválido', estado: docInvalido.length ? 'warn' : 'ok', cantidad: docInvalido.length, muestra: docInvalido.slice(0, 10).map((t) => t.nombre) },
      { clave: 'mapeo', titulo: 'Reglas de mapeo activas', estado: reglas > 0 ? 'ok' : 'warn', cantidad: reglas, muestra: [] },
    ];
    const bloqueantes = items.filter((i) => i.estado === 'error').length;
    return { anio, listoParaExportar: bloqueantes === 0, bloqueantes, items };
  }
}
