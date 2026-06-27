import { Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { DocumentosService, UploadFile } from './documentos.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/**
 * Gestión documental de soportes contables. Admin y contador suben/consultan;
 * solo admin elimina (un soporte borrado es irrecuperable).
 */
@Controller('documentos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  @Get()
  list(@Query('entidadTipo') entidadTipo?: string, @Query('entidadId') entidadId?: string, @Query('categoria') categoria?: string) {
    return this.documentos.list(entidadTipo, entidadId, categoria);
  }

  @Get('resumen')
  resumen() {
    return this.documentos.resumen();
  }

  @Post(':entidadTipo/:entidadId')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /^(application\/pdf|image\/(jpe?g|png|webp)|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|application\/xml|text\/xml)$/i.test(file.mimetype);
        cb(ok ? null : new Error('Formato no soportado. Use PDF, imagen, CSV, Excel o XML.'), ok);
      },
    }),
  )
  subir(
    @Param('entidadTipo') entidadTipo: string,
    @Param('entidadId') entidadId: string,
    @UploadedFile() file: UploadFile,
    @Body('categoria') categoria: string,
    @Body('notas') notas: string,
    @Req() req: Request,
  ) {
    return this.documentos.subir(entidadTipo, entidadId, file, { categoria, notas, subidoPor: (req as any).user?.username });
  }

  @Delete(':id')
  @Roles('admin')
  eliminar(@Param('id') id: string) {
    return this.documentos.eliminar(id);
  }
}
