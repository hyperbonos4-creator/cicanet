import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CollectionsService } from '../collections/collections.service';
import { WhatsappService } from '../../channels/whatsapp/whatsapp.service';

const money = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

type Bucket = 'porVencer' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90mas';

interface ReglaDunning { habilitado: boolean; plantilla: string }
type DunningConfig = Record<Bucket, ReglaDunning>;

const DEFAULTS: DunningConfig = {
  porVencer: { habilitado: false, plantilla: 'Hola {nombre} 👋, tu factura de internet CICANET por {saldo} vence pronto. Puedes pagar fácil desde la app. ¡Gracias!' },
  d1_30: { habilitado: true, plantilla: 'Hola {nombre}, te recordamos que tu factura de CICANET por {saldo} está vencida ({dias} días). Paga desde la app para evitar la suspensión. ¡Gracias!' },
  d31_60: { habilitado: true, plantilla: '{nombre}, tu servicio CICANET tiene un saldo vencido de {saldo} ({dias} días). Por favor regulariza para no afectar tu servicio. Paga desde la app o escríbenos.' },
  d61_90: { habilitado: true, plantilla: 'Aviso importante {nombre}: tu cuenta CICANET registra {saldo} vencido hace {dias} días. Tu servicio está en riesgo de suspensión. Comunícate con nosotros para un acuerdo de pago.' },
  d90mas: { habilitado: true, plantilla: '{nombre}, tu cuenta CICANET tiene {saldo} en mora ({dias} días). Para reactivar/mantener tu servicio debes ponerte al día. Contáctanos hoy.' },
};

const ORDEN: Bucket[] = ['d90mas', 'd61_90', 'd31_60', 'd1_30', 'porVencer'];

/**
 * Cobranza automática (dunning): según el aging, envía recordatorios por WhatsApp.
 * Idempotente por (cliente, bucket, mes) — no spamea. Best-effort: un fallo de
 * envío nunca afecta la cartera ni el servicio del cliente.
 */
@Injectable()
export class DunningService {
  private readonly logger = new Logger('DunningService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly collections: CollectionsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async getConfig(): Promise<DunningConfig> {
    const s = await this.prisma.setting.findUnique({ where: { clave: 'dunning_config' } });
    return { ...DEFAULTS, ...((s?.valor as any) ?? {}) };
  }
  async setConfig(cfg: Partial<DunningConfig>, actor?: string) {
    const merged = { ...(await this.getConfig()), ...cfg };
    await this.prisma.setting.upsert({
      where: { clave: 'dunning_config' },
      update: { valor: merged as any, actualizadoPor: actor },
      create: { clave: 'dunning_config', valor: merged as any, actualizadoPor: actor },
    });
    return merged;
  }

  private mesActual(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** Bucket prioritario (más vencido) con saldo > 0 de un cliente. */
  private bucketPrioritario(buckets: Record<Bucket, number>): Bucket | null {
    for (const b of ORDEN) if ((buckets[b] ?? 0) > 0) return b;
    return null;
  }

  private render(plantilla: string, vars: { nombre: string; saldo: number; dias: number }): string {
    return plantilla
      .replace(/{nombre}/g, vars.nombre)
      .replace(/{saldo}/g, money(vars.saldo))
      .replace(/{dias}/g, String(vars.dias));
  }

  /** Construye la lista de destinatarios (sin enviar). */
  async preview() {
    const cfg = await this.getConfig();
    const aging = await this.collections.aging({ soloVencidos: false });
    const mes = this.mesActual();
    const yaEnviados = await this.prisma.dunningEnvio.findMany({ where: { periodoMes: mes, estado: 'enviado' }, select: { clienteId: true, bucket: true } });
    const enviadoSet = new Set(yaEnviados.map((e) => `${e.clienteId}|${e.bucket}`));

    const objetivos: { clienteId: string; nombre: string; telefono: string | null; bucket: Bucket; saldo: number; dias: number; mensaje: string; yaEnviado: boolean; habilitado: boolean }[] = [];
    for (const c of aging.clientes) {
      const bucket = this.bucketPrioritario(c.buckets as Record<Bucket, number>);
      if (!bucket) continue;
      const regla = cfg[bucket];
      const saldo = (c.buckets as Record<Bucket, number>)[bucket];
      const mensaje = this.render(regla.plantilla, { nombre: c.cliente.nombre, saldo, dias: c.maxDias });
      objetivos.push({
        clienteId: c.cliente.id,
        nombre: c.cliente.nombre,
        telefono: c.cliente.telefono,
        bucket,
        saldo,
        dias: c.maxDias,
        mensaje,
        yaEnviado: enviadoSet.has(`${c.cliente.id}|${bucket}`),
        habilitado: regla.habilitado,
      });
    }
    return { mes, total: objetivos.length, aEnviar: objetivos.filter((o) => o.habilitado && !o.yaEnviado && o.telefono).length, objetivos };
  }

  /** Ejecuta los envíos. aplicar=false simula (no envía ni registra). */
  async run(opts: { aplicar?: boolean } = {}) {
    const { objetivos, mes } = await this.preview();
    let enviados = 0;
    let fallidos = 0;
    let omitidos = 0;
    const detalle: { cliente: string; bucket: string; estado: string; error?: string }[] = [];

    for (const o of objetivos) {
      if (!o.habilitado || o.yaEnviado) { omitidos++; continue; }
      if (!o.telefono) { omitidos++; detalle.push({ cliente: o.nombre, bucket: o.bucket, estado: 'sin_telefono' }); continue; }

      if (!opts.aplicar) {
        detalle.push({ cliente: o.nombre, bucket: o.bucket, estado: 'simulado' });
        continue;
      }

      const env = await this.whatsapp.sendText(o.telefono, o.mensaje);
      const estado = env.ok ? 'enviado' : 'fallido';
      if (env.ok) enviados++; else fallidos++;
      try {
        // upsert: un envío fallido puede reintentarse; el exitoso no se repite (idempotencia).
        await this.prisma.dunningEnvio.upsert({
          where: { clienteId_bucket_periodoMes: { clienteId: o.clienteId, bucket: o.bucket, periodoMes: mes } },
          update: { canal: 'whatsapp', destino: env.numero, mensaje: o.mensaje, estado, error: env.error ?? null, creadoEn: new Date() },
          create: { clienteId: o.clienteId, bucket: o.bucket, periodoMes: mes, canal: 'whatsapp', destino: env.numero, mensaje: o.mensaje, estado, error: env.error ?? null },
        });
      } catch (e: any) {
        this.logger.warn(`No se registró dunning de ${o.nombre}: ${e.message}`);
      }
      detalle.push({ cliente: o.nombre, bucket: o.bucket, estado, error: env.error });
    }
    return { aplicado: !!opts.aplicar, mes, enviados, fallidos, omitidos, detalle };
  }

  /** Historial de envíos del mes. */
  historial(mes?: string) {
    const m = mes ?? this.mesActual();
    return this.prisma.dunningEnvio.findMany({ where: { periodoMes: m }, orderBy: { creadoEn: 'desc' }, take: 500 });
  }
}
