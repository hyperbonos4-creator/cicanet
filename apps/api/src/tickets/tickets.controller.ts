import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

class UpdateEstadoDto {
  @IsIn(['abierto', 'en_proceso', 'resuelto', 'cerrado'])
  estado: string;
}

class CreateTicketDto {
  @IsString() @MinLength(3) @MaxLength(200)
  asunto: string;

  @IsString() @MinLength(3) @MaxLength(2000)
  descripcion: string;

  @IsOptional() @IsIn(['tecnico', 'facturacion', 'comercial', 'general'])
  categoria?: string;

  @IsOptional() @IsString()
  clienteId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  contacto?: string;
}

/** Bandeja de tickets de soporte (los crea Cica o el staff). Admin/operador. */
@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(@Body() dto: CreateTicketDto, @Req() req: Request) {
    return this.tickets.create({ ...dto, creadoPor: (req as any).user?.username, origen: 'panel' });
  }

  @Get()
  list(@Query('estado') estado?: string, @Query('categoria') categoria?: string) {
    return this.tickets.list({ estado, categoria });
  }

  @Get('stats')
  stats() {
    return this.tickets.stats();
  }

  @Patch(':id')
  updateEstado(@Param('id') id: string, @Body() dto: UpdateEstadoDto) {
    return this.tickets.updateEstado(id, dto.estado);
  }
}
