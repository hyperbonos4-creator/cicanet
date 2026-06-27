import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { MeService } from './me.service';
import { ClientesService } from '../clientes/clientes.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

class CambiarClaveDto {
  @IsString()
  @MinLength(4)
  nueva: string;
}

function clienteId(req: Request): string {
  return (req as any).user?.clienteId ?? (req as any).user?.id;
}

/** Autoservicio del cliente autenticado (rol `cliente`). */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('cliente')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly clientes: ClientesService,
  ) {}

  @Get('perfil')
  perfil(@Req() req: Request) {
    return this.me.perfil(clienteId(req));
  }

  @Get('servicio')
  servicio(@Req() req: Request) {
    return this.me.servicio(clienteId(req));
  }

  @Get('facturas')
  facturas(@Req() req: Request) {
    return this.me.facturas(clienteId(req));
  }

  @Get('estado-cuenta')
  estadoCuenta(@Req() req: Request) {
    return this.me.estadoCuenta(clienteId(req));
  }

  @Get('facturas/:id')
  facturaDetalle(@Param('id') id: string, @Req() req: Request) {
    return this.me.facturaDetalle(clienteId(req), id);
  }

  @Post('clave')
  async cambiarClave(@Body() dto: CambiarClaveDto, @Req() req: Request) {
    await this.clientes.cambiarClave(clienteId(req), dto.nueva);
    return { ok: true };
  }
}
