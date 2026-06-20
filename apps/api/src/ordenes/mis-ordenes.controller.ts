import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { OrdenesService } from './ordenes.service';
import { JwtAuthGuard } from '../auth/guards';

class UpdateEstadoDto {
  @IsIn(['en_camino', 'en_sitio', 'completada', 'cancelada'])
  estado: string;
}

class CompletarDto {
  @IsOptional() @IsString() @MaxLength(2000)
  notas?: string;
}

/**
 * Apartado del TÉCNICO en la app móvil. Cualquier usuario autenticado entra,
 * pero solo ve y gestiona las órdenes que le fueron asignadas (filtradas por su
 * username). El técnico avanza el estado, sube fotos con la cámara y completa
 * la orden. El admin no tiene acceso a estos endpoints (usa los de staff).
 *
 * Se registra ANTES que OrdenesController para que el segmento literal `mias`
 * tenga prioridad sobre `:id` del controlador de staff.
 */
@Controller('ordenes/mias')
@UseGuards(JwtAuthGuard)
export class MisOrdenesController {
  constructor(private readonly ordenes: OrdenesService) {}

  @Get()
  mine(@Req() req: Request) {
    return this.ordenes.listMias((req as any).user?.username);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: Request) {
    const orden = await this.ordenes.getOne(id);
    this.assertOwner(orden, req);
    return orden;
  }

  @Patch(':id/estado')
  async updateEstado(@Param('id') id: string, @Body() dto: UpdateEstadoDto, @Req() req: Request) {
    const orden = await this.ordenes.getOne(id);
    this.assertOwner(orden, req);
    return this.ordenes.updateEstado(id, dto.estado, (req as any).user?.username);
  }

  @Post(':id/completar')
  async completar(@Param('id') id: string, @Body() dto: CompletarDto, @Req() req: Request) {
    const orden = await this.ordenes.getOne(id);
    this.assertOwner(orden, req);
    return this.ordenes.completar(id, dto.notas, (req as any).user?.username);
  }

  /** Sube una foto de evidencia (multipart `file` + campo opcional `nota`). */
  @Post(':id/foto')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpe?g|png|webp)$/i.test(file.mimetype);
        cb(ok ? null : new Error('Formato no soportado. Usa JPG, PNG o WebP.'), ok);
      },
    }),
  )
  async addFoto(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
    @Body('nota') nota: string,
    @Req() req: Request,
  ) {
    const orden = await this.ordenes.getOne(id);
    this.assertOwner(orden, req);
    return this.ordenes.addFoto(id, file, nota, (req as any).user?.username);
  }

  /** La OT debe estar asignada al técnico que hace la petición. */
  private assertOwner(orden: { tecnico: string | null }, req: Request) {
    const username = (req as any).user?.username;
    if (!orden.tecnico || orden.tecnico !== username) {
      throw new ForbiddenException('Esta orden no está asignada a ti.');
    }
  }
}
