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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClientesService, type ClienteFilters } from './clientes.service';
import { CreateClienteDto, UpdateClienteDto } from './dto';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/** Suscriptores del ISP. Lectura: autenticado. Mutación: admin/operador. */
@Controller('clientes')
@UseGuards(JwtAuthGuard)
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  list(@Query() q: ClienteFilters) {
    return this.clientes.list(q);
  }

  @Get('stats')
  stats() {
    return this.clientes.stats();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.clientes.get(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  create(@Body() dto: CreateClienteDto, @Req() req: Request) {
    return this.clientes.create({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  update(@Param('id') id: string, @Body() dto: UpdateClienteDto) {
    return this.clientes.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operador')
  remove(@Param('id') id: string) {
    return this.clientes.remove(id);
  }
}
