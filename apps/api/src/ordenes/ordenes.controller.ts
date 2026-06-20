import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import { OrdenesService } from './ordenes.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { UsersService } from '../users/users.service';

class CreateOrdenDto {
  @IsString() @MinLength(3) @MaxLength(200)
  titulo: string;

  @IsString() @MinLength(3) @MaxLength(300)
  direccion: string;

  @IsOptional() @IsIn(['instalacion', 'visita', 'reparacion'])
  tipo?: string;

  @IsOptional() @IsIn(['baja', 'media', 'alta'])
  prioridad?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  descripcion?: string;

  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;

  @IsOptional() @IsString() tecnico?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() @MaxLength(200) clienteNombre?: string;
  @IsOptional() @IsString() @MaxLength(120) contacto?: string;
  @IsOptional() @IsString() fechaProgramada?: string;
}

class AsignarDto {
  @IsOptional() @IsString() tecnico?: string | null;
}

class UpdateEstadoDto {
  @IsIn(['asignada', 'en_camino', 'en_sitio', 'completada', 'cancelada'])
  estado: string;
}

/**
 * Bandeja de órdenes de trabajo del staff. El admin/operador crea, asigna y
 * supervisa. La evidencia fotográfica la sube el TÉCNICO desde su app (ver
 * MisOrdenesController), nunca el admin.
 */
@Controller('ordenes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador')
export class OrdenesController {
  constructor(
    private readonly ordenes: OrdenesService,
    private readonly users: UsersService,
  ) {}

  /** Lista los técnicos disponibles para asignar una OT. */
  @Get('tecnicos')
  tecnicos() {
    return this.users.listByRole('tecnico');
  }

  @Post()
  create(@Body() dto: CreateOrdenDto, @Req() req: Request) {
    return this.ordenes.create({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Get()
  list(
    @Query('estado') estado?: string,
    @Query('tecnico') tecnico?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.ordenes.list({ estado, tecnico, tipo });
  }

  @Get('stats')
  stats() {
    return this.ordenes.stats();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.ordenes.getOne(id);
  }

  @Patch(':id/asignar')
  asignar(@Param('id') id: string, @Body() dto: AsignarDto) {
    return this.ordenes.asignar(id, dto.tecnico ?? null);
  }

  @Patch(':id/estado')
  updateEstado(@Param('id') id: string, @Body() dto: UpdateEstadoDto, @Req() req: Request) {
    return this.ordenes.updateEstado(id, dto.estado, (req as any).user?.username);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordenes.remove(id);
  }
}
