import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ESTADOS = ['abierto', 'en_proceso', 'resuelto', 'cerrado'];

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista tickets (opcionalmente por estado o categoría), más recientes primero. */
  async list(filtros: { estado?: string; categoria?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (filtros.estado && ESTADOS.includes(filtros.estado)) where.estado = filtros.estado;
    if (filtros.categoria) where.categoria = filtros.categoria;
    return this.prisma.ticket.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: 200,
    });
  }

  /** Tickets creados por un usuario concreto (vista del cliente). */
  async listMine(creadoPor: string) {
    if (!creadoPor) return [];
    return this.prisma.ticket.findMany({
      where: { creadoPor },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }

  /** Métricas rápidas para el encabezado del panel. */
  async stats() {
    const tickets = await this.prisma.ticket.findMany({ select: { estado: true } });
    const porEstado: Record<string, number> = { abierto: 0, en_proceso: 0, resuelto: 0, cerrado: 0 };
    for (const t of tickets) porEstado[t.estado] = (porEstado[t.estado] ?? 0) + 1;
    return { total: tickets.length, porEstado };
  }

  /** Cambia el estado de un ticket. */
  async updateEstado(id: string, estado: string) {
    if (!ESTADOS.includes(estado)) {
      throw new BadRequestException(`Estado inválido. Usa uno de: ${ESTADOS.join(', ')}`);
    }
    const existe = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Ticket no encontrado.');
    return this.prisma.ticket.update({ where: { id }, data: { estado } });
  }
}
