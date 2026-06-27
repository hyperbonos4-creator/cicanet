import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from '../../config';
import { PrismaService } from '../../platform/prisma/prisma.service';

/** Tipos y estados válidos de una orden de trabajo (validados aquí + en DTO). */
const TIPOS = ['instalacion', 'visita', 'reparacion'];
const ESTADOS = ['asignada', 'en_camino', 'en_sitio', 'completada', 'cancelada'];
const PRIORIDADES = ['baja', 'media', 'alta'];

/**
 * Transiciones permitidas del flujo de campo. El técnico avanza la OT por estos
 * estados; el admin/operador puede cancelar mientras no esté completada.
 */
const TRANSICIONES: Record<string, string[]> = {
  asignada: ['en_camino', 'cancelada'],
  en_camino: ['en_sitio', 'cancelada'],
  en_sitio: ['completada', 'cancelada'],
  completada: [],
  cancelada: [],
};

/** Extensiones permitidas para la evidencia fotográfica, por MIME type. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type Foto = { id: string; url: string; nota?: string; ts: string; autor?: string };
type HistEntry = { estado: string; ts: string; por?: string };

/**
 * Órdenes de trabajo de campo. El admin/operador las crea y asigna a un técnico;
 * el técnico las gestiona desde su apartado en la app (cambia estado, sube fotos
 * con la cámara, completa con notas). Las fotos se guardan en
 * DATA_DIR/uploads/ordenes/<id>/ y se sirven en /api/uploads/ordenes/<id>/<file>
 * (mismo handler estático que la evidencia de infra).
 */
@Injectable()
export class OrdenesService {
  private readonly logger = new Logger('OrdenesService');
  private readonly uploadsDir = resolve(process.cwd(), config.geo.dataDir, 'uploads', 'ordenes');

  constructor(private readonly prisma: PrismaService) {}

  // ---- creación / asignación (admin / operador) ----

  async create(input: {
    tipo?: string;
    titulo: string;
    descripcion?: string;
    direccion: string;
    lat?: number;
    lng?: number;
    prioridad?: string;
    tecnico?: string;
    clienteId?: string;
    clienteNombre?: string;
    contacto?: string;
    fechaProgramada?: string;
    creadoPor?: string;
  }) {
    const titulo = (input.titulo || '').trim();
    const direccion = (input.direccion || '').trim();
    if (titulo.length < 3) throw new BadRequestException('El título es obligatorio.');
    if (direccion.length < 3) throw new BadRequestException('La dirección es obligatoria.');

    const tipo = TIPOS.includes(String(input.tipo)) ? String(input.tipo) : 'instalacion';
    const prioridad = PRIORIDADES.includes(String(input.prioridad)) ? String(input.prioridad) : 'media';
    const tecnico = input.tecnico?.trim() || null;
    const codigo = `OT-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const clienteId = await this.resolverClienteId(input.clienteId);

    let fechaProgramada: Date | null = null;
    if (input.fechaProgramada) {
      const d = new Date(input.fechaProgramada);
      if (!Number.isNaN(d.getTime())) fechaProgramada = d;
    }

    const historial: HistEntry[] = [{ estado: 'asignada', ts: new Date().toISOString(), por: input.creadoPor }];

    return this.prisma.ordenTrabajo.create({
      data: {
        codigo,
        tipo,
        prioridad,
        estado: 'asignada',
        titulo: titulo.slice(0, 200),
        descripcion: input.descripcion?.slice(0, 2000) ?? null,
        direccion: direccion.slice(0, 300),
        lat: typeof input.lat === 'number' ? input.lat : null,
        lng: typeof input.lng === 'number' ? input.lng : null,
        tecnico,
        clienteId,
        clienteNombre: input.clienteNombre?.slice(0, 200) ?? null,
        contacto: input.contacto?.slice(0, 120) ?? null,
        fechaProgramada,
        historial: historial as any,
        fotos: [] as any,
        creadoPor: input.creadoPor ?? null,
      },
    });
  }

  private async resolverClienteId(value?: string): Promise<string | null> {
    const v = (value || '').trim();
    if (!v) return null;
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const cliente = esUuid
      ? await this.prisma.cliente.findUnique({ where: { id: v } })
      : await this.prisma.cliente.findUnique({ where: { codigo: v } });
    return cliente?.id ?? null;
  }

  // ---- lectura ----

  /** Bandeja del admin/operador, con filtros opcionales. */
  async list(filtros: { estado?: string; tecnico?: string; tipo?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (filtros.estado && ESTADOS.includes(filtros.estado)) where.estado = filtros.estado;
    if (filtros.tecnico) where.tecnico = filtros.tecnico;
    if (filtros.tipo && TIPOS.includes(filtros.tipo)) where.tipo = filtros.tipo;
    return this.prisma.ordenTrabajo.findMany({
      where,
      orderBy: [{ estado: 'asc' }, { fechaProgramada: 'asc' }, { creadoEn: 'desc' }],
      take: 300,
    });
  }

  /** Métricas para el encabezado del panel. */
  async stats() {
    const rows = await this.prisma.ordenTrabajo.findMany({ select: { estado: true } });
    const porEstado: Record<string, number> = {
      asignada: 0, en_camino: 0, en_sitio: 0, completada: 0, cancelada: 0,
    };
    for (const r of rows) porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
    const activas = porEstado.asignada + porEstado.en_camino + porEstado.en_sitio;
    return { total: rows.length, activas, porEstado };
  }

  /** Órdenes del técnico (su apartado en la app). Las activas primero. */
  async listMias(tecnico: string) {
    if (!tecnico) return [];
    return this.prisma.ordenTrabajo.findMany({
      where: { tecnico },
      orderBy: [{ estado: 'asc' }, { fechaProgramada: 'asc' }, { creadoEn: 'desc' }],
      take: 200,
    });
  }

  async getOne(id: string) {
    const orden = await this.prisma.ordenTrabajo.findUnique({ where: { id } });
    if (!orden) throw new NotFoundException('Orden de trabajo no encontrada.');
    return orden;
  }

  // ---- mutación ----

  /** Reasigna la OT a otro técnico (admin/operador). */
  async asignar(id: string, tecnico: string | null) {
    await this.getOne(id);
    return this.prisma.ordenTrabajo.update({
      where: { id },
      data: { tecnico: tecnico?.trim() || null },
    });
  }

  /**
   * Cambia el estado respetando las transiciones válidas. `actor` es quien lo
   * hace (técnico o staff). Si la OT está asignada a un técnico, solo él (o el
   * staff) puede moverla — el control de rol se aplica en el controlador.
   */
  async updateEstado(id: string, estado: string, actor?: string) {
    if (!ESTADOS.includes(estado)) {
      throw new BadRequestException(`Estado inválido. Usa uno de: ${ESTADOS.join(', ')}`);
    }
    const orden = await this.getOne(id);
    if (orden.estado === estado) return orden;
    const permitidas = TRANSICIONES[orden.estado] ?? [];
    if (!permitidas.includes(estado)) {
      throw new BadRequestException(
        `No se puede pasar de "${orden.estado}" a "${estado}".`,
      );
    }
    return this.aplicarEstado(orden, estado, actor);
  }

  /** Completa la OT (estado completada + notas del técnico). */
  async completar(id: string, notas: string | undefined, actor?: string) {
    const orden = await this.getOne(id);
    if (orden.estado === 'completada') return orden;
    if (orden.estado === 'cancelada') {
      throw new BadRequestException('Una orden cancelada no se puede completar.');
    }
    return this.aplicarEstado(orden, 'completada', actor, notas);
  }

  private async aplicarEstado(orden: any, estado: string, actor?: string, notas?: string) {
    const historial: HistEntry[] = Array.isArray(orden.historial) ? (orden.historial as HistEntry[]) : [];
    historial.push({ estado, ts: new Date().toISOString(), por: actor });
    const data: Record<string, unknown> = { estado, historial: historial as any };
    if (estado === 'completada') data.completadaEn = new Date();
    if (typeof notas === 'string' && notas.trim()) data.notasTecnico = notas.trim().slice(0, 2000);
    return this.prisma.ordenTrabajo.update({ where: { id: orden.id }, data });
  }

  /**
   * Adjunta una foto de evidencia (la captura el técnico con la cámara). La
   * imagen se guarda en DATA_DIR/uploads/ordenes/<id>/ y se sirve estáticamente.
   * `solicitante` debe ser el técnico asignado (validado aquí por seguridad).
   */
  async addFoto(
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    nota: string | undefined,
    autor?: string,
  ): Promise<{ orden: any; foto: Foto }> {
    const orden = await this.getOne(id);
    if (autor && orden.tecnico && orden.tecnico !== autor) {
      throw new ForbiddenException('Solo el técnico asignado puede subir evidencia.');
    }
    if (!file?.buffer?.length) throw new BadRequestException('No se recibió ninguna imagen.');
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('Formato no soportado. Usa JPG, PNG o WebP.');

    const folder = resolve(this.uploadsDir, id);
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const fileId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const filename = `${fileId}.${ext}`;
    writeFileSync(resolve(folder, filename), file.buffer);

    const foto: Foto = {
      id: fileId,
      url: `/api/uploads/ordenes/${id}/${filename}`,
      nota: nota?.slice(0, 300),
      ts: new Date().toISOString(),
      autor,
    };
    const fotos: Foto[] = Array.isArray(orden.fotos) ? (orden.fotos as unknown as Foto[]) : [];
    fotos.push(foto);
    const actualizada = await this.prisma.ordenTrabajo.update({
      where: { id },
      data: { fotos: fotos as any },
    });
    this.logger.log(`Evidencia añadida a ${orden.codigo} (${Math.round(file.size / 1024)} KB)`);
    return { orden: actualizada, foto };
  }

  /** Elimina una OT y su carpeta de evidencia (admin/operador). */
  async remove(id: string) {
    await this.getOne(id);
    await this.prisma.ordenTrabajo.delete({ where: { id } });
    try {
      const folder = resolve(this.uploadsDir, id);
      if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
    } catch (e: any) {
      this.logger.warn(`No se pudo borrar la evidencia de ${id}: ${e.message}`);
    }
    return { id };
  }
}
