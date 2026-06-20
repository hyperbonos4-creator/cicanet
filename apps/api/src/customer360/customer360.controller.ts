import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Customer360Service } from './customer360.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Vista 360 del suscriptor (staff). */
@Controller('clientes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operador', 'tecnico')
export class Customer360Controller {
  constructor(private readonly c360: Customer360Service) {}

  @Get(':id/360')
  get(@Param('id') id: string) {
    return this.c360.get(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id') id: string) {
    return this.c360.timeline(id);
  }
}
