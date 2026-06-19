import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SETTING_KEY = 'soporte_whatsapp';
const DEFAULT_MENSAJE =
  'Hola CICANET, necesito ayuda con mi servicio de internet.';

/** Forma persistida de la configuración de soporte. */
type SoporteWhatsappValue = {
  numero: string; // dígitos en formato internacional, ej. "573001234567"
  mensaje: string;
  habilitado: boolean;
};

/** Respuesta pública (lista para usar por web y app). */
export type SoporteWhatsappConfig = {
  numero: string;
  numeroFormateado: string;
  mensaje: string;
  habilitado: boolean;
  /** Deep link wa.me listo para abrir el chat con mensaje precargado. */
  url: string | null;
};

@Injectable()
export class SupportService {
  private readonly logger = new Logger('SupportService');

  constructor(private readonly prisma: PrismaService) {}

  /** Lee la configuración de soporte; devuelve defaults seguros si no existe. */
  async getWhatsapp(): Promise<SoporteWhatsappConfig> {
    const row = await this.prisma.setting.findUnique({ where: { clave: SETTING_KEY } });
    const value = (row?.valor as SoporteWhatsappValue | undefined) ?? {
      numero: '',
      mensaje: DEFAULT_MENSAJE,
      habilitado: false,
    };
    return this.toConfig(value);
  }

  /** Crea/actualiza la configuración. Normaliza el número a formato internacional. */
  async setWhatsapp(
    input: { numero: string; mensaje?: string; habilitado?: boolean },
    actor?: string,
  ): Promise<SoporteWhatsappConfig> {
    const numero = normalizeNumber(input.numero);
    if (!numero) {
      throw new BadRequestException(
        'Número de WhatsApp inválido. Usa el número con indicativo de país (ej. +57 300 123 4567).',
      );
    }
    const value: SoporteWhatsappValue = {
      numero,
      mensaje: (input.mensaje ?? '').trim() || DEFAULT_MENSAJE,
      habilitado: input.habilitado ?? true,
    };

    await this.prisma.setting.upsert({
      where: { clave: SETTING_KEY },
      create: { clave: SETTING_KEY, valor: value, actualizadoPor: actor },
      update: { valor: value, actualizadoPor: actor },
    });
    this.logger.log(`Soporte WhatsApp actualizado por ${actor ?? 'sistema'}`);
    return this.toConfig(value);
  }

  private toConfig(v: SoporteWhatsappValue): SoporteWhatsappConfig {
    const url =
      v.habilitado && v.numero
        ? `https://wa.me/${v.numero}?text=${encodeURIComponent(v.mensaje)}`
        : null;
    return {
      numero: v.numero,
      numeroFormateado: formatNumber(v.numero),
      mensaje: v.mensaje,
      habilitado: v.habilitado,
      url,
    };
  }
}

/**
 * Normaliza un número a dígitos en formato internacional (sin + ni espacios).
 * Heurística Colombia: si llega un móvil local de 10 dígitos que empieza por 3,
 * se antepone el indicativo 57. Si ya trae indicativo, se respeta.
 */
export function normalizeNumber(raw: string): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  // Quita un 00 inicial de marcación internacional.
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Móvil colombiano local (3XXXXXXXXX) → anteponer 57.
  if (digits.length === 10 && digits.startsWith('3')) {
    digits = `57${digits}`;
  }
  // Rango razonable de longitud internacional E.164 (con país).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Formato legible para mostrar (no para wa.me). Caso Colombia: +57 300 123 4567. */
function formatNumber(digits: string): string {
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length === 12) {
    const n = digits.slice(2);
    return `+57 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+${digits}`;
}
