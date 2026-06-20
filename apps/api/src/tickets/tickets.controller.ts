import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

class UpdateEstadoDto {
  @IsIn(['abierto', 'en_proceso', 'resuelto', 'cerrado'])
  estado: string;
}

/** Bandeja de tickets de soporte (los crea Cica o el staff). Admin/operador. */
@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

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
