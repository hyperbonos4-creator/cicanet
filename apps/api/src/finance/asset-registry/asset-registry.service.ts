import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';

const CATEGORIAS = ['onu', 'router', 'switch', 'olt', 'nap', 'antena', 'otro'];
const ESTADOS = ['stock', 'disponible', 'asignado', 'comodato', 'dañado', 'baja'];

// Transiciones válidas del inventario operativo de red (separado del state-machine
// documental porque es ciclo físico, no contable).
const TRANSICIONES: Record<string, string[]> = {
  stock: ['disponible', 'asignado', 'comodato', 'dañado', 'baja'],
  disponible: ['asignado', 'comodato', 'dañado', 'baja', 'stock'],
  asignado: ['disponible', 'comodato', 'dañado', 'baja'],
  comodato: ['disponible', 'dañado', 'baja'],
  dañado: ['disponible', 'baja'],
  baja: [],
};

export interface CrearAssetInput {
  categoria: string;
  marca?: string;
  modelo?: string;
  serial?: string;
  mac?: string;
  ubicacion?: string;
  napId?: string;
  costo?: number;
  notas?: string;
  creadoPor?: string;
}

/**
 * Inventario operativo de activo de red (Fase G): seriales, MAC, comodato, stock
 * y ubicación. Se separa del activo fijo contable (`ActivoFijo`, depreciación) y
 * se vincula a él opcionalmente (`activoFijoId`) cuando el equipo se capitaliza.
 * El ciclo físico (stock→asignado→comodato→baja) NO toca el ledger; la baja/venta
 * contable se hace en el módulo de activos fijos.
 */
@Injectable()
export class AssetRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  private async siguienteCodigo(): Promise<string> {
    const n = await this.prisma.assetRegistry.count();
    return `AR-${String(n + 1).padStart(6, '0')}`;
  }

  list(filtro: { estado?: string; categoria?: string; servicioId?: string; q?: string } = {}) {
    const where: Prisma.AssetRegistryWhereInput = {
      estado: filtro.estado,
      categoria: filtro.categoria,
      servicioId: filtro.servicioId,
    };
    if (filtro.q) {
      where.OR = [
        { serial: { contains: filtro.q, mode: 'insensitive' } },
        { mac: { contains: filtro.q, mode: 'insensitive' } },
        { modelo: { contains: filtro.q, mode: 'insensitive' } },
        { codigo: { contains: filtro.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.assetRegistry.findMany({ where, orderBy: { creadoEn: 'desc' }, take: 500 });
  }

  async resumen() {
    const [porEstado, porCategoria, sinCapitalizar, comodato] = await Promise.all([
      this.prisma.assetRegistry.groupBy({ by: ['estado'], _count: { _all: true } }),
      this.prisma.assetRegistry.groupBy({ by: ['categoria'], _count: { _all: true }, _sum: { costo: true } }),
      this.prisma.assetRegistry.count({ where: { activoFijoId: null, costo: { gt: 0 } } }),
      this.prisma.assetRegistry.count({ where: { comodato: true } }),
    ]);
    return {
      porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count._all])),
      porCategoria: porCategoria.map((c) => ({ categoria: c.categoria, cantidad: c._count._all, costo: Number(c._sum.costo ?? 0) })),
      sinCapitalizar,
      enComodato: comodato,
    };
  }

  async crear(input: CrearAssetInput) {
    if (!CATEGORIAS.includes(input.categoria)) throw new BadRequestException(`Categoría inválida (${CATEGORIAS.join(', ')}).`);
    if (input.serial) {
      const dup = await this.prisma.assetRegistry.findUnique({ where: { serial: input.serial } });
      if (dup) throw new BadRequestException(`Ya existe un activo con el serial ${input.serial}.`);
    }
    const codigo = await this.siguienteCodigo();
    return this.prisma.assetRegistry.create({
      data: {
        codigo,
        categoria: input.categoria,
        marca: input.marca ?? null,
        modelo: input.modelo ?? null,
        serial: input.serial ?? null,
        mac: input.mac ?? null,
        ubicacion: input.ubicacion ?? 'bodega',
        napId: input.napId ?? null,
        costo: input.costo != null ? new Prisma.Decimal(input.costo) : null,
        notas: input.notas ?? null,
        creadoPor: input.creadoPor ?? null,
      },
    });
  }

  private async get(id: string) {
    const a = await this.prisma.assetRegistry.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Activo no encontrado.');
    return a;
  }

  private validarTransicion(desde: string, hacia: string) {
    if (desde === hacia) return;
    if (!(TRANSICIONES[desde] ?? []).includes(hacia)) {
      throw new BadRequestException(`Transición inválida: ${desde} → ${hacia}. Permitidas: ${(TRANSICIONES[desde] ?? []).join(', ') || '(ninguna)'}.`);
    }
  }

  /** Asigna el equipo a un servicio/cliente (comodato o instalación). */
  async asignar(id: string, body: { servicioId?: string; clienteId?: string; napId?: string; comodato?: boolean; ubicacion?: string }) {
    const a = await this.get(id);
    const nuevoEstado = body.comodato ? 'comodato' : 'asignado';
    this.validarTransicion(a.estado, nuevoEstado);
    return this.prisma.assetRegistry.update({
      where: { id },
      data: {
        estado: nuevoEstado,
        servicioId: body.servicioId ?? a.servicioId,
        clienteId: body.clienteId ?? a.clienteId,
        napId: body.napId ?? a.napId,
        comodato: body.comodato ?? a.comodato,
        ubicacion: body.ubicacion ?? a.ubicacion,
      },
    });
  }

  /** Devuelve a stock (retiro de comodato / desinstalación). */
  async liberar(id: string) {
    const a = await this.get(id);
    this.validarTransicion(a.estado, 'disponible');
    return this.prisma.assetRegistry.update({
      where: { id },
      data: { estado: 'disponible', servicioId: null, clienteId: null, comodato: false, ubicacion: 'bodega' },
    });
  }

  async cambiarEstado(id: string, estado: string) {
    if (!ESTADOS.includes(estado)) throw new BadRequestException(`Estado inválido (${ESTADOS.join(', ')}).`);
    const a = await this.get(id);
    this.validarTransicion(a.estado, estado);
    return this.prisma.assetRegistry.update({ where: { id }, data: { estado } });
  }

  /** Vincula el equipo de red al activo fijo contable que lo capitaliza. */
  async vincularContable(id: string, activoFijoId: string) {
    await this.get(id);
    const af = await this.prisma.activoFijo.findUnique({ where: { id: activoFijoId } });
    if (!af) throw new BadRequestException('Activo fijo contable no encontrado.');
    return this.prisma.assetRegistry.update({ where: { id }, data: { activoFijoId } });
  }
}
