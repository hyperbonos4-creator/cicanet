import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const num = (d: Prisma.Decimal | null) => (d != null ? Number(d) : 0);

export interface MiServicio {
  plan: string;
  estadoServicio: string;
  estadoCliente: string;
  activo: boolean;
  velocidadBajada: number | null;
  velocidadSubida: number | null;
  tecnologia: string;
  tarifa: number;
  saldo: number;
  diaCorte: number | null;
  direccion: string | null;
  barrio: string | null;
}

export interface MiFactura {
  id: string;
  periodo: string;
  total: number;
  estado: string;
  fechaVencimiento: string | null;
  pagada: boolean;
}

/**
 * Lecturas de autoservicio del cliente (portal/app). Resuelve por `clienteId`
 * (que viene del JWT de un usuario con rol `cliente`). No expone datos de otros
 * clientes.
 */
@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async perfil(clienteId: string) {
    const c = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!c) throw new NotFoundException('Cliente no encontrado.');
    return {
      codigo: c.codigo,
      nombre: c.nombre,
      documento: c.documento,
      email: c.email,
      telefonoMovil: c.telefonoMovil,
      estado: c.estado,
    };
  }

  async servicio(clienteId: string): Promise<MiServicio> {
    const s = await this.prisma.servicio.findFirst({
      where: { clienteId },
      include: { cliente: true, punto: true },
      orderBy: { creadoEn: 'asc' },
    });
    if (!s) throw new NotFoundException('No tienes un servicio registrado.');
    return {
      plan: s.planNombre,
      estadoServicio: s.estado,
      estadoCliente: s.cliente.estado,
      activo: s.estado === 'activo',
      velocidadBajada: s.velocidadBajada ?? null,
      velocidadSubida: s.velocidadSubida ?? null,
      tecnologia: s.tecnologia,
      tarifa: num(s.tarifa),
      saldo: num(s.saldo),
      diaCorte: s.diaCorte ?? null,
      direccion: s.punto?.direccion ?? null,
      barrio: s.punto?.barrio ?? null,
    };
  }

  async facturas(clienteId: string): Promise<MiFactura[]> {
    const servicios = await this.prisma.servicio.findMany({
      where: { clienteId },
      select: { id: true },
    });
    const ids = servicios.map((s) => s.id);
    if (!ids.length) return [];
    const facturas = await this.prisma.factura.findMany({
      where: { servicioId: { in: ids } },
      orderBy: { fechaEmision: 'desc' },
      take: 24,
    });
    return facturas.map((f) => ({
      id: f.id,
      periodo: f.periodo,
      total: num(f.total),
      estado: f.estado,
      fechaVencimiento: f.fechaVencimiento ? f.fechaVencimiento.toISOString().slice(0, 10) : null,
      pagada: f.estado === 'pagada',
    }));
  }

  /** Factura pendiente más antigua (para el pago en un clic). */
  async facturaPendiente(clienteId: string): Promise<MiFactura | null> {
    const facturas = await this.facturas(clienteId);
    return facturas.filter((f) => !f.pagada && f.estado !== 'anulada').sort((a, b) => a.periodo.localeCompare(b.periodo))[0] ?? null;
  }
}
