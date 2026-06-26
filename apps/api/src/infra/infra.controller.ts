import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import type { Request } from 'express';
import { InfraService } from './infra.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

const ASSET_TYPES = [
  'POP', 'OLT', 'Switch', 'Router', 'NAP', 'Splitter',
  'UPS', 'Servidor', 'Camara', 'Fibra', 'Empalme', 'ONU', 'Cliente',
];

class CreateAssetDto {
  @IsIn(ASSET_TYPES)
  tipo: any;

  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsNumber() lng?: number;
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsString() marca?: string;
  @IsOptional() @IsString() modelo?: string;
  @IsOptional() @IsString() serie?: string;
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsInt() puertosTotal?: number;
  @IsOptional() @IsInt() puertosUsados?: number;
  @IsOptional() @IsNumber() planMensual?: number;
  @IsOptional() atributos?: Record<string, any>;
}

class SetParentDto {
  @IsOptional() @IsString() parentId?: string | null;
}

class EvaluateConstructionDto {
  @IsNumber() lng: number;
  @IsNumber() lat: number;
}

class CreateFiberDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsIn(['monomodo', 'multimodo']) tipoFibra?: 'monomodo' | 'multimodo';
  @IsOptional() @IsInt() hilos?: number;
  @IsOptional() @IsString() origenId?: string;
  @IsOptional() @IsString() destinoId?: string;
  @IsOptional() @IsString() origenDireccion?: string;
  @IsOptional() @IsString() destinoDireccion?: string;
  @IsOptional() origen?: { lng: number; lat: number };
  @IsOptional() destino?: { lng: number; lat: number };
}

class GeneratePortsDto {
  @IsInt() total: number;
  @IsOptional() @IsIn(['entrada', 'salida']) rol?: 'entrada' | 'salida';
}

class ConnectPortDto {
  @IsOptional() @IsString() servicioId?: string;
  @IsOptional() @IsString() bPuertoId?: string;
  @IsOptional() @IsInt() hilo?: number;
  @IsOptional() @IsString() segmentoFibraId?: string;
}

/** Gemelo Digital de la Red. Lectura: autenticado. Mutación: admin/operador. */
@Controller('infra')
@UseGuards(JwtAuthGuard)
export class InfraController {
  constructor(private readonly infra: InfraService) {}

  @Get('bundle')
  bundle() {
    return this.infra.getBundle();
  }

  /** Modo construcción / simulador de venta: evalúa un punto del mapa. */
  @Post('construction/evaluate')
  evaluateConstruction(@Body() dto: EvaluateConstructionDto) {
    return this.infra.evaluateConstruction(dto.lng, dto.lat);
  }

  /** Motor de asignación: NAP candidatas (rankeadas por viabilidad) para un punto. */
  @Get('suggest-naps')
  suggestNaps(@Query('lng') lng: string, @Query('lat') lat: string) {
    return this.infra.suggestNaps(parseFloat(lng), parseFloat(lat));
  }

  @Get('assets')
  assets() {
    return this.infra.listAssets();
  }

  @Get('assets/:id')
  assetDetail(@Param('id') id: string) {
    return this.infra.getAssetDetail(id);
  }

  @Put('assets/:id/parent')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  setParent(@Param('id') id: string, @Body() dto: SetParentDto) {
    return this.infra.setParent(id, dto.parentId ?? null);
  }

  @Post('assets')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  createAsset(@Body() dto: CreateAssetDto, @Req() req: Request) {
    // Los puertos van dentro de atributos (capacidad de NAP/CTO); el plan mensual es del Cliente.
    const atributos = { ...(dto.atributos || {}) };
    if (dto.puertosTotal != null) atributos.puertosTotal = dto.puertosTotal;
    if (dto.puertosUsados != null) atributos.puertosUsados = dto.puertosUsados;
    return this.infra.createAsset({
      tipo: dto.tipo,
      nombre: dto.nombre,
      direccion: dto.direccion,
      lng: dto.lng,
      lat: dto.lat,
      marca: dto.marca,
      modelo: dto.modelo,
      serie: dto.serie,
      estado: dto.estado,
      planMensual: dto.planMensual,
      atributos,
      creadoPor: (req as any).user?.username,
    });
  }

  @Delete('assets/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  deleteAsset(@Param('id') id: string) {
    return this.infra.deleteAsset(id);
  }

  // ---- Evidencia fotográfica (vista de calle propia, georreferenciada) ----

  /**
   * Sube una foto de evidencia a un activo (multipart `file` + campo `categoria`).
   * Los técnicos también pueden subir: capturan la realidad en campo al instalar.
   * Límite 8 MB, solo imágenes JPG/PNG/WebP.
   */
  @Post('assets/:id/photos')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador', 'tecnico')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpe?g|png|webp)$/i.test(file.mimetype);
        cb(ok ? null : new Error('Formato no soportado. Usa JPG, PNG o WebP.'), ok);
      },
    }),
  )
  addPhoto(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
    @Body('categoria') categoria: string,
    @Req() req: Request,
  ) {
    return this.infra.addPhoto(id, file, categoria, (req as any).user?.username);
  }

  @Delete('assets/:id/photos/:photoId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  deletePhoto(@Param('id') id: string, @Param('photoId') photoId: string) {
    return this.infra.removePhoto(id, photoId);
  }

  @Get('fiber')
  fiber() {
    return this.infra.listFiber();
  }

  @Post('fiber')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  createFiber(@Body() dto: CreateFiberDto, @Req() req: Request) {
    return this.infra.createFiber({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Delete('fiber/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  deleteFiber(@Param('id') id: string) {
    return this.infra.deleteFiber(id);
  }

  // ---- Conectividad a nivel de puerto + trazado óptico ----

  /** Puertos y ocupación real de un activo (NAP/OLT/Splitter). */
  @Get('assets/:id/ports')
  ports(@Param('id') id: string) {
    return this.infra.portsDetail(id);
  }

  /** Genera/asegura N puertos físicos para un activo. */
  @Post('assets/:id/ports/generate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  generatePorts(@Param('id') id: string, @Body() dto: GeneratePortsDto) {
    return this.infra.generatePorts(id, dto.total, dto.rol ?? 'salida');
  }

  /** Conecta un puerto a un servicio (cliente) o a otro puerto (cadena óptica). */
  @Post('ports/:puertoId/connect')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador', 'tecnico')
  connectPort(@Param('puertoId') puertoId: string, @Body() dto: ConnectPortDto, @Req() req: Request) {
    return this.infra.connectPort(puertoId, { ...dto, creadoPor: (req as any).user?.username });
  }

  /** Libera un puerto (desconecta su enlace). */
  @Post('ports/:puertoId/disconnect')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador', 'tecnico')
  disconnectPort(@Param('puertoId') puertoId: string) {
    return this.infra.disconnectPort(puertoId);
  }

  /** Trazado óptico de un activo hacia la raíz (POP/OLT). */
  @Get('assets/:id/trace')
  trace(@Param('id') id: string) {
    return this.infra.tracePath(id);
  }

  /** Exporta la red en formato OFDS (Open Fibre Data Standard). */
  @Get('export/ofds')
  exportOfds() {
    return this.infra.exportOfds();
  }
}
