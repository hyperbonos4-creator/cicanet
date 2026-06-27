import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../../platform/auth/guards';

/**
 * Vista del cliente: sus propios tickets. Cualquier usuario autenticado (sin
 * requerir rol admin) ve los tickets que originó desde la app.
 */
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class MyTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('mine')
  mine(@Req() req: Request) {
    const user = (req as any).user;
    return this.tickets.listMine(user?.username);
  }
}
