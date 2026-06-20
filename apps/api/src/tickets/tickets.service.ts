import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const ESTADOS = ['abierto', 'en_proceso', 'resuelto', 'cerrado'];
const CATEGORIAS = ['tecnico', 'facturacion', 'comercial', 'general'];

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea un ticket (desde el panel/staff o el asistente). */
  async create(input: {
    asunto: string;
    descripcion: string;
    categoria?: string;
    clienteId?: string;
    contacto?: string;
    creadoPor?: string;
    origen?: string;
  }) {
    const asunto = (input.asunto || '').trim();
    const descripcion = (input.descripcion || '').trim();
    if (asunto.length < 3 || descripcion.length < 3) {
      throw new BadRequestException('Asunto y descripción son obligatorios.');
    }
    const categoria = CATEGORIAS.includes(String(input.categoria)) ? String(input.categoria) : 'general';
    const codigo = `TCK-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    // clienteId puede llegar como UUID o como código público (CLI-0001): se
    // normaliza al UUID real (la columna es uuid). Si no resuelve, queda null.
    const clienteId = await this.resolverClienteId(input.clienteId);
    return this.prisma.ticket.create({
      data: {
        codigo,
        asunto: asunto.slice(0, 200),
        descripcion: descripcion.slice(0, 2000),
        categoria,
        clienteId,
        contacto: input.contacto?.slice(0, 120) ?? null,
        creadoPor: input.creadoPor ?? null,
        origen: input.origen ?? 'panel',
      },
    });
  }

  /** Acepta UUID o código (CLI-0001) y devuelve el UUID del cliente, o null. */
  private async resolverClienteId(value?: string): Promise<string | null> {
    const v = (value || '').trim();
    if (!v) return null;
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const cliente = esUuid
      ? await this.prisma.cliente.findUnique({ where: { id: v } })
      : await this.prisma.cliente.findUnique({ where: { codigo: v } });
    return cliente?.id ?? null;
  }

  /** Lista tickets (opcionalmente por estado o categoría), más recientes primero. */
  async list(filtros: { estado?: string; categoria?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (filtros.estado && ESTADOS.includes(filtros.estado)) where.estado = filtros.estado;
    if (filtros.categoria) where.categoria = filtros.categoria;
    const tickets = await this.prisma.ticket.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: 200,
    });
    return this.ligarClientes(tickets);
  }

  /**
   * Liga tickets a su cliente cuando no tienen `clienteId` guardado: los creados
   * por un cliente con sesión llevan su documento en `creadoPor`. Así el panel
   * abre el 360 incluso para tickets anteriores a este vínculo. Una sola consulta
   * por documento (no N+1).
   */
  private async ligarClientes<T extends { clienteId: string | null; creadoPor: string | null }>(tickets: T[]): Promise<T[]> {
    const docs = [...new Set(tickets.filter((t) => !t.clienteId && t.creadoPor).map((t) => t.creadoPor as string))];
    if (docs.length === 0) return tickets;
    const clientes = await this.prisma.cliente.findMany({
      where: { documento: { in: docs } },
      select: { id: true, documento: true },
    });
    const porDoc = new Map(clientes.map((c) => [c.documento, c.id]));
    for (const t of tickets) {
      if (!t.clienteId && t.creadoPor && porDoc.has(t.creadoPor)) {
        t.clienteId = porDoc.get(t.creadoPor) ?? null;
      }
    }
    return tickets;
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
