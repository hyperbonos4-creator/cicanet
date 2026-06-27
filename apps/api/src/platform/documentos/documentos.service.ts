import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../../config';

const ENTIDADES = ['asiento', 'compra', 'recibo', 'dian', 'activo', 'nomina', 'tesoreria', 'general'];
const CATEGORIAS = ['factura', 'soporte_pago', 'rut', 'contrato', 'extracto', 'otro'];

// Tipos permitidos para soportes contables (documentos y comprobantes, no ejecutables).
const MIME_OK = /^(application\/pdf|image\/(jpe?g|png|webp)|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|application\/xml|text\/xml)$/i;
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

export interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/**
 * Gestión documental de soportes contables (PARTE V). Adjunta facturas, soportes
 * de pago, RUT, contratos y extractos a cualquier entidad contable (asiento,
 * compra, recibo, etc.). Sigue el patrón de almacenamiento del proyecto: el binario
 * vive en DATA_DIR/uploads/contabilidad/ y se sirve estático en /api/uploads/.
 */
@Injectable()
export class DocumentosService {
  private readonly baseDir = resolve(process.cwd(), config.geo.dataDir, 'uploads', 'contabilidad');

  constructor(private readonly prisma: PrismaService) {}

  private async siguienteCodigo(): Promise<string> {
    const n = await this.prisma.documentoSoporte.count();
    return `DOC-${String(n + 1).padStart(6, '0')}`;
  }

  private validarEntidad(entidadTipo: string) {
    if (!ENTIDADES.includes(entidadTipo)) {
      throw new BadRequestException(`Entidad inválida (${ENTIDADES.join(', ')}).`);
    }
  }

  async list(entidadTipo?: string, entidadId?: string, categoria?: string) {
    return this.prisma.documentoSoporte.findMany({
      where: { entidadTipo, entidadId, categoria },
      orderBy: { creadoEn: 'desc' },
      take: 500,
    });
  }

  async resumen() {
    const [total, porCategoria] = await Promise.all([
      this.prisma.documentoSoporte.count(),
      this.prisma.documentoSoporte.groupBy({ by: ['categoria'], _count: { _all: true }, _sum: { tamano: true } }),
    ]);
    return {
      total,
      porCategoria: porCategoria.map((c) => ({ categoria: c.categoria, cantidad: c._count._all, bytes: Number(c._sum.tamano ?? 0) })),
    };
  }

  async subir(
    entidadTipo: string,
    entidadId: string,
    file: UploadFile | undefined,
    meta: { categoria?: string; notas?: string; subidoPor?: string },
  ) {
    this.validarEntidad(entidadTipo);
    if (!entidadId || entidadId.trim().length < 1) throw new BadRequestException('Falta el identificador de la entidad.');
    if (!file || !file.buffer?.length) throw new BadRequestException('No se recibió ningún archivo.');
    if (!MIME_OK.test(file.mimetype)) throw new BadRequestException('Formato no soportado. Use PDF, imagen, CSV, Excel o XML.');

    const categoria = meta.categoria && CATEGORIAS.includes(meta.categoria) ? meta.categoria : 'otro';
    const ext = EXT_BY_MIME[file.mimetype.toLowerCase()] ?? 'bin';
    const folder = resolve(this.baseDir, entidadTipo, entidadId);
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

    const fileId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const filename = `${fileId}.${ext}`;
    writeFileSync(resolve(folder, filename), file.buffer);

    const codigo = await this.siguienteCodigo();
    return this.prisma.documentoSoporte.create({
      data: {
        codigo,
        entidadTipo,
        entidadId,
        categoria,
        nombreOriginal: (meta && file.originalname) ? file.originalname.slice(0, 200) : `${codigo}.${ext}`,
        archivo: filename,
        url: `/api/uploads/contabilidad/${entidadTipo}/${entidadId}/${filename}`,
        mimeType: file.mimetype,
        tamano: file.size ?? file.buffer.length,
        notas: meta.notas?.slice(0, 500) ?? null,
        subidoPor: meta.subidoPor ?? null,
      },
    });
  }

  async eliminar(id: string) {
    const doc = await this.prisma.documentoSoporte.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    try {
      const abs = resolve(this.baseDir, doc.entidadTipo, doc.entidadId, doc.archivo);
      if (existsSync(abs)) rmSync(abs, { force: true });
    } catch {
      /* el registro se elimina aunque el binario ya no exista */
    }
    await this.prisma.documentoSoporte.delete({ where: { id } });
    return { ok: true };
  }
}
