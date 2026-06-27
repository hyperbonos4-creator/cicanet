import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { normalizeNumber } from '../../operations/support/support.service';

export interface CrearHandoffInput {
  clienteId?: string;
  nombre?: string;
  telefono?: string;
  motivo?: string;
  origen?: string;
}

/**
 * Handoff bot → asesor humano. Cuando un cliente pide "hablar con un asesor", el
 * asistente crea una `SolicitudAsesor` que aparece en el panel de WhatsApp. El
 * agente la atiende abriendo wa.me hacia el número del cliente con un saludo
 * NUEVO (sin trasladar lo que el cliente habló con el bot).
 *
 * Idempotencia suave: no se crean dos solicitudes pendientes para el mismo
 * cliente/teléfono en una ventana corta (evita duplicar si el bot la invoca dos veces).
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger('HandoffService');
  private static readonly DEDUP_MS = 10 * 60 * 1000; // 10 min

  constructor(private readonly prisma: PrismaService) {}

  /** Crea (o reutiliza) una solicitud de asesor pendiente. Best-effort. */
  async crear(input: CrearHandoffInput) {
    const telefono = input.telefono ? normalizeNumber(input.telefono) : null;

    // Dedup: ¿ya hay una pendiente reciente para este cliente/teléfono?
    const desde = new Date(Date.now() - HandoffService.DEDUP_MS);
    const existente = await this.prisma.solicitudAsesor.findFirst({
      where: {
        estado: 'pendiente',
        creadoEn: { gte: desde },
        OR: [
          ...(input.clienteId ? [{ clienteId: input.clienteId }] : []),
          ...(telefono ? [{ telefono }] : []),
        ],
      },
      orderBy: { creadoEn: 'desc' },
    });
    if (existente) return existente;

    return this.prisma.solicitudAsesor.create({
      data: {
        clienteId: input.clienteId ?? null,
        nombre: input.nombre ?? null,
        telefono: telefono ?? null,
        motivo: input.motivo?.slice(0, 300) ?? null,
        origen: input.origen ?? 'bot',
      },
    });
  }

  /** Lista de solicitudes (pendientes primero). */
  list(estado?: string) {
    return this.prisma.solicitudAsesor.findMany({
      where: estado ? { estado } : undefined,
      orderBy: [{ estado: 'asc' }, { creadoEn: 'desc' }],
      take: 100,
    });
  }

  async resumen() {
    const pendientes = await this.prisma.solicitudAsesor.count({ where: { estado: 'pendiente' } });
    return { pendientes };
  }

  /**
   * Marca una solicitud como atendida y devuelve el deep link wa.me hacia el
   * cliente con un saludo nuevo (no incluye el historial del bot).
   */
  async atender(id: string, actor?: string) {
    const s = await this.prisma.solicitudAsesor.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Solicitud no encontrada.');
    if (s.estado === 'pendiente') {
      await this.prisma.solicitudAsesor.update({
        where: { id },
        data: { estado: 'atendida', atendidoPor: actor ?? null, atendidoEn: new Date() },
      });
    }
    const numero = s.telefono ? normalizeNumber(s.telefono) : null;
    const nombre = (s.nombre ?? '').split(' ')[0] || '';
    const saludo = `Hola${nombre ? ' ' + nombre : ''}, te saluda un asesor de CICANET. ¿En qué puedo ayudarte?`;
    return {
      ok: true,
      numero,
      url: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(saludo)}` : null,
    };
  }

  async cerrar(id: string) {
    const s = await this.prisma.solicitudAsesor.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Solicitud no encontrada.');
    return this.prisma.solicitudAsesor.update({ where: { id }, data: { estado: 'cerrada' } });
  }
}
