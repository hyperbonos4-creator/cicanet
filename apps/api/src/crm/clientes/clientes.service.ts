import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import {
  Cliente,
  ClienteStats,
  ESTADOS_CLIENTE,
  ESTADOS_SERVICIO,
  TECNOLOGIAS,
  type EstadoCliente,
  type EstadoServicio,
  type Tecnologia,
} from './domain/types';
import { exigirTransicionValida } from './domain/service-state';

export interface ClienteFilters {
  q?: string;
  estado?: string;
  estadoServicio?: string;
  tecnologia?: string;
  barrio?: string;
}

// Servicio con sus relaciones, tal como lo consultamos para mapear a la
// forma plana `Cliente` que espera el frontend.
type ServicioFull = Prisma.ServicioGetPayload<{
  include: { cliente: true; punto: true };
}>;

/**
 * Repositorio de suscriptores sobre PostgreSQL (Prisma).
 *
 * Mantiene la MISMA API pública que la versión JSON (list/get/stats/create/
 * update/remove devolviendo la ficha plana `Cliente`), pero por dentro
 * persiste el modelo normalizado: Cliente + PuntoInstalacion + Servicio.
 * El `id` público es el `codigo` (CLI-0001).
 */
@Injectable()
export class ClientesService {
  private readonly logger = new Logger('ClientesService');

  constructor(private readonly prisma: PrismaService) {}

  // ---- autenticación del cliente (portal/app) ----
  /**
   * Verifica las credenciales de un cliente para el login del portal/app.
   * Usuario = documento. Clave: si el cliente tiene `claveHash` se compara con
   * bcrypt; si no, la clave inicial por defecto es su propio documento.
   * Devuelve la identidad del cliente o null.
   */
  async verifyCliente(
    documento: string,
    password: string,
  ): Promise<{ id: string; documento: string; nombre: string; codigo: string } | null> {
    const doc = String(documento || '').trim();
    if (!doc || !password) return null;
    const cliente = await this.prisma.cliente.findUnique({ where: { documento: doc } });
    if (!cliente || cliente.estado === 'retirado') return null;
    const ok = cliente.claveHash
      ? await bcrypt.compare(password, cliente.claveHash)
      : password === doc;
    if (!ok) return null;
    return { id: cliente.id, documento: cliente.documento, nombre: cliente.nombre, codigo: cliente.codigo };
  }

  /** Identidad del cliente por id (para refrescar el token). */
  async verifyClienteById(
    clienteId: string,
  ): Promise<{ id: string; documento: string; nombre: string; codigo: string } | null> {
    const c = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!c || c.estado === 'retirado') return null;
    return { id: c.id, documento: c.documento, nombre: c.nombre, codigo: c.codigo };
  }

  /** Cambia la clave del portal del cliente. */
  async cambiarClave(clienteId: string, nueva: string): Promise<void> {
    if (!nueva || nueva.length < 4) {
      throw new BadRequestException('La clave debe tener al menos 4 caracteres.');
    }
    const hash = await bcrypt.hash(nueva, 10);
    await this.prisma.cliente.update({ where: { id: clienteId }, data: { claveHash: hash } });
  }

  // ---- lectura ----
  async list(filters: ClienteFilters = {}): Promise<Cliente[]> {    const where: Prisma.ServicioWhereInput = {};
    if (filters.estadoServicio) where.estado = filters.estadoServicio;
    if (filters.tecnologia) where.tecnologia = filters.tecnologia;
    if (filters.estado) where.cliente = { estado: filters.estado };
    if (filters.barrio)
      where.punto = { barrio: { equals: filters.barrio, mode: 'insensitive' } };

    const servicios = await this.prisma.servicio.findMany({
      where,
      include: { cliente: true, punto: true },
      orderBy: { creadoEn: 'desc' },
    });

    let flat = servicios.map((s) => this.toFlat(s));

    const q = filters.q?.trim().toLowerCase();
    if (q) {
      flat = flat.filter((c) =>
        `${c.nombre} ${c.documento} ${c.id} ${c.plan} ${c.email || ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    return flat;
  }

  async get(id: string): Promise<Cliente> {
    const s = await this.prisma.servicio.findFirst({
      where: { cliente: { codigo: id } },
      include: { cliente: true, punto: true },
      orderBy: { creadoEn: 'asc' },
    });
    if (!s) throw new NotFoundException('Cliente no encontrado.');
    return this.toFlat(s);
  }

  async stats(): Promise<ClienteStats> {
    const servicios = await this.prisma.servicio.findMany({
      include: { cliente: true },
    });
    const porEstado = Object.fromEntries(
      ESTADOS_CLIENTE.map((e) => [e, 0]),
    ) as Record<EstadoCliente, number>;
    const porServicio = Object.fromEntries(
      ESTADOS_SERVICIO.map((e) => [e, 0]),
    ) as Record<EstadoServicio, number>;
    const porTecnologia = Object.fromEntries(
      TECNOLOGIAS.map((t) => [t, 0]),
    ) as Record<Tecnologia, number>;
    let ingresoMensual = 0;
    let saldoPendiente = 0;

    for (const s of servicios) {
      const eCli = s.cliente.estado as EstadoCliente;
      const eSrv = s.estado as EstadoServicio;
      const tec = s.tecnologia as Tecnologia;
      if (eCli in porEstado) porEstado[eCli] += 1;
      if (eSrv in porServicio) porServicio[eSrv] += 1;
      if (tec in porTecnologia) porTecnologia[tec] += 1;
      const tarifa = s.tarifa ? Number(s.tarifa) : 0;
      const saldo = s.saldo ? Number(s.saldo) : 0;
      if (s.estado === 'activo') ingresoMensual += tarifa;
      saldoPendiente += saldo;
    }

    return {
      total: servicios.length,
      porEstado,
      porServicio,
      porTecnologia,
      ingresoMensual: Math.round(ingresoMensual),
      saldoPendiente: Math.round(saldoPendiente),
    };
  }

  // ---- escritura ----
  async create(
    input: Partial<Cliente> & { creadoPor?: string },
  ): Promise<Cliente> {
    this.validate(input, true);
    const documento = String(input.documento).trim();

    const dup = await this.prisma.cliente.findUnique({ where: { documento } });
    if (dup)
      throw new BadRequestException(
        `Ya existe un cliente con el documento ${documento}.`,
      );

    const codigo = await this.nextCodigo('CLI');

    const created = await this.prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: {
          codigo,
          tipoDocumento: input.tipoDocumento as string,
          documento,
          nombre: input.nombre!.trim(),
          tipoCliente: input.tipoCliente as string,
          email: input.email ?? null,
          telefonoMovil: input.telefonoMovil ?? null,
          telefonoFijo: input.telefonoFijo ?? null,
          estado: (input.estado as string) || 'activo',
          notas: input.notas ?? null,
          creadoPor: input.creadoPor ?? null,
        },
      });
      const punto = await tx.puntoInstalacion.create({
        data: { clienteId: cliente.id, ...this.puntoData(input) },
      });
      const servicio = await tx.servicio.create({
        data: {
          clienteId: cliente.id,
          puntoId: punto.id,
          ...this.servicioData(input),
          activoNapId: await this.resolveActivoNapId(input.napId, tx),
          estado: (input.estadoServicio as string) || 'instalacion_pendiente',
        },
        include: { cliente: true, punto: true },
      });
      return servicio;
    });

    this.logger.log(`Cliente creado ${codigo} (${documento})`);
    return this.toFlat(created);
  }

  async update(id: string, input: Partial<Cliente>): Promise<Cliente> {
    const current = await this.prisma.servicio.findFirst({
      where: { cliente: { codigo: id } },
      include: { cliente: true, punto: true },
      orderBy: { creadoEn: 'asc' },
    });
    if (!current) throw new NotFoundException('Cliente no encontrado.');

    // Documento: si cambia, debe seguir siendo único.
    if (input.documento && input.documento.trim() !== current.cliente.documento) {
      const doc = input.documento.trim();
      const other = await this.prisma.cliente.findUnique({
        where: { documento: doc },
      });
      if (other && other.id !== current.cliente.id)
        throw new BadRequestException(
          `Ya existe un cliente con el documento ${doc}.`,
        );
    }

    // Máquina de estados del servicio.
    if (input.estadoServicio && input.estadoServicio !== current.estado) {
      exigirTransicionValida(
        current.estado as EstadoServicio,
        input.estadoServicio as EstadoServicio,
      );
    }

    this.validate({ ...this.toFlat(current), ...input }, false);

    const updated = await this.prisma.$transaction(async (tx) => {
      const clienteData = this.clienteData(input);
      if (Object.keys(clienteData).length)
        await tx.cliente.update({
          where: { id: current.clienteId },
          data: clienteData,
        });

      const puntoData = this.puntoData(input, true);
      if (Object.keys(puntoData).length)
        await tx.puntoInstalacion.update({
          where: { id: current.puntoId },
          data: puntoData,
        });

      const servicioData = this.servicioData(input, true);
      if (input.estadoServicio) servicioData.estado = input.estadoServicio;
      // Mantén el FK a la NAP sincronizado cuando cambia napId.
      if (input.napId !== undefined) servicioData.activoNapId = await this.resolveActivoNapId(input.napId, tx);

      return tx.servicio.update({
        where: { id: current.id },
        data: servicioData,
        include: { cliente: true, punto: true },
      });
    });

    return this.toFlat(updated);
  }

  async remove(id: string): Promise<{ id: string }> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { codigo: id },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado.');
    // Cascade borra punto + servicio + facturas.
    await this.prisma.cliente.delete({ where: { id: cliente.id } });
    return { id };
  }

  // ---- mapeo flat <-> normalizado ----
  private toFlat(s: ServicioFull): Cliente {
    const c = s.cliente;
    const p = s.punto;
    const dateOnly = (d: Date | null) =>
      d ? d.toISOString().slice(0, 10) : undefined;
    const num = (d: Prisma.Decimal | null) => (d != null ? Number(d) : undefined);

    return {
      id: c.codigo,
      tipoDocumento: c.tipoDocumento as Cliente['tipoDocumento'],
      documento: c.documento,
      nombre: c.nombre,
      tipoCliente: c.tipoCliente as Cliente['tipoCliente'],
      email: c.email ?? undefined,
      telefonoMovil: c.telefonoMovil ?? undefined,
      telefonoFijo: c.telefonoFijo ?? undefined,

      direccion: p.direccion,
      barrio: p.barrio ?? undefined,
      comuna: p.comuna ?? undefined,
      ciudad: p.ciudad,
      departamento: p.departamento ?? undefined,
      estrato: p.estrato ?? undefined,
      lat: p.lat ?? undefined,
      lng: p.lng ?? undefined,
      referencias: p.referencias ?? undefined,

      plan: s.planNombre,
      velocidadBajada: s.velocidadBajada ?? undefined,
      velocidadSubida: s.velocidadSubida ?? undefined,
      tecnologia: s.tecnologia as Tecnologia,
      napId: s.napId ?? undefined,
      puerto: s.puerto ?? undefined,
      onuSerial: s.onuSerial ?? undefined,
      ip: s.ip ?? undefined,
      vlan: s.vlan ?? undefined,
      fechaInstalacion: dateOnly(s.fechaInstalacion),
      estadoServicio: s.estado as EstadoServicio,

      cicloFacturacion: (s.cicloFacturacion as Cliente['cicloFacturacion']) ?? undefined,
      diaCorte: s.diaCorte ?? undefined,
      metodoPago: (s.metodoPago as Cliente['metodoPago']) ?? undefined,
      tarifa: num(s.tarifa),
      saldo: num(s.saldo),
      numeroContrato: s.numeroContrato ?? undefined,
      fechaInicioContrato: dateOnly(s.fechaInicioContrato),
      fechaFinContrato: dateOnly(s.fechaFinContrato),

      estado: c.estado as EstadoCliente,
      notas: c.notas ?? undefined,
      creadoPor: c.creadoPor ?? undefined,
      creadoEn: c.creadoEn.toISOString(),
      actualizadoEn: c.actualizadoEn?.toISOString(),
    };
  }

  /** Campos del bloque 1 (persona) presentes en el input. */
  private clienteData(input: Partial<Cliente>): Prisma.ClienteUpdateInput {
    const d: any = {};
    if (input.tipoDocumento !== undefined) d.tipoDocumento = input.tipoDocumento;
    if (input.documento !== undefined) d.documento = input.documento.trim();
    if (input.nombre !== undefined) d.nombre = input.nombre.trim();
    if (input.tipoCliente !== undefined) d.tipoCliente = input.tipoCliente;
    if (input.email !== undefined) d.email = input.email;
    if (input.telefonoMovil !== undefined) d.telefonoMovil = input.telefonoMovil;
    if (input.telefonoFijo !== undefined) d.telefonoFijo = input.telefonoFijo;
    if (input.estado !== undefined) d.estado = input.estado;
    if (input.notas !== undefined) d.notas = input.notas;
    return d;
  }

  /** Campos del bloque 2 (punto de instalación). */
  private puntoData(input: Partial<Cliente>, partial = false): any {
    const d: any = {};
    const set = (k: keyof Cliente, v: any) => {
      if (input[k] !== undefined) d[v ?? k] = input[k];
    };
    set('direccion', 'direccion');
    set('barrio', 'barrio');
    set('comuna', 'comuna');
    set('ciudad', 'ciudad');
    set('departamento', 'departamento');
    set('estrato', 'estrato');
    set('lat', 'lat');
    set('lng', 'lng');
    set('referencias', 'referencias');
    // En create exigimos los obligatorios (ya validados): direccion/ciudad.
    if (!partial) {
      d.direccion = input.direccion!.trim();
      d.ciudad = input.ciudad!.trim();
    }
    return d;
  }

  /** Campos de los bloques 3 y 4 (servicio: plan, técnica, facturación). */
  private servicioData(input: Partial<Cliente>, partial = false): any {
    const d: any = {};
    if (input.plan !== undefined) d.planNombre = input.plan.trim();
    if (input.velocidadBajada !== undefined) d.velocidadBajada = input.velocidadBajada;
    if (input.velocidadSubida !== undefined) d.velocidadSubida = input.velocidadSubida;
    if (input.tecnologia !== undefined) d.tecnologia = input.tecnologia;
    if (input.napId !== undefined) d.napId = input.napId;
    if (input.puerto !== undefined) d.puerto = input.puerto;
    if (input.onuSerial !== undefined) d.onuSerial = input.onuSerial;
    if (input.ip !== undefined) d.ip = input.ip;
    if (input.vlan !== undefined) d.vlan = input.vlan;
    if (input.fechaInstalacion !== undefined)
      d.fechaInstalacion = input.fechaInstalacion ? new Date(input.fechaInstalacion) : null;
    if (input.cicloFacturacion !== undefined) d.cicloFacturacion = input.cicloFacturacion;
    if (input.diaCorte !== undefined) d.diaCorte = input.diaCorte;
    if (input.metodoPago !== undefined) d.metodoPago = input.metodoPago;
    if (input.tarifa !== undefined) d.tarifa = input.tarifa;
    if (input.saldo !== undefined) d.saldo = input.saldo;
    if (input.numeroContrato !== undefined) d.numeroContrato = input.numeroContrato;
    if (input.fechaInicioContrato !== undefined)
      d.fechaInicioContrato = input.fechaInicioContrato ? new Date(input.fechaInicioContrato) : null;
    if (input.fechaFinContrato !== undefined)
      d.fechaFinContrato = input.fechaFinContrato ? new Date(input.fechaFinContrato) : null;
    // En create, planNombre es obligatorio (ya validado).
    if (!partial) d.planNombre = input.plan!.trim();
    return d;
  }

  // ---- helpers ----
  private validate(c: Partial<Cliente>, requireBase: boolean) {
    if (requireBase) {
      if (!c.documento || String(c.documento).trim().length < 3)
        throw new BadRequestException('El documento es obligatorio.');
      if (!c.nombre || c.nombre.trim().length < 2)
        throw new BadRequestException('El nombre / razón social es obligatorio.');
      if (!c.direccion || c.direccion.trim().length < 3)
        throw new BadRequestException('La dirección de instalación es obligatoria.');
      if (!c.ciudad || c.ciudad.trim().length < 2)
        throw new BadRequestException('La ciudad es obligatoria.');
      if (!c.plan || c.plan.trim().length < 1)
        throw new BadRequestException('El plan es obligatorio.');
    }
    if (c.estrato != null && (c.estrato < 1 || c.estrato > 6))
      throw new BadRequestException('El estrato debe estar entre 1 y 6.');
    if (c.diaCorte != null && (c.diaCorte < 1 || c.diaCorte > 31))
      throw new BadRequestException('El día de corte debe estar entre 1 y 31.');
  }

  /**
   * Resuelve el FK a la NAP (Activo) desde el `napId` que envía el formulario,
   * que puede ser el id del activo (NAP-001) o su nombre. Devuelve null si no
   * hay napId o no existe el activo (no rompe el alta: el FK queda vacío).
   */
  private async resolveActivoNapId(
    napId: string | undefined | null,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const ref = (napId ?? '').trim();
    if (!ref) return null;
    const activo = await tx.activo.findFirst({
      where: { OR: [{ id: ref }, { nombre: ref }] },
      select: { id: true },
    });
    return activo?.id ?? null;
  }

  /** Calcula el siguiente código CLI-NNNN a partir del máximo actual. */
  private async nextCodigo(prefix: string): Promise<string> {
    const rows = await this.prisma.cliente.findMany({
      where: { codigo: { startsWith: `${prefix}-` } },
      select: { codigo: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = r.codigo.match(new RegExp(`^${prefix}-(\\d+)`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }
}
