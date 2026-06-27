import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SupportService } from './support.service';
import { UpdateWhatsappSupportDto } from './dto';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /**
   * Configuración del canal de soporte WhatsApp. La consume la app del cliente
   * (botón "Soporte") y el panel admin. Requiere sesión.
   */
  @Get('whatsapp')
  @UseGuards(JwtAuthGuard)
  getWhatsapp() {
    return this.support.getWhatsapp();
  }

  /** Actualiza el número de soporte. Solo administradores. */
  @Put('whatsapp')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  setWhatsapp(@Body() dto: UpdateWhatsappSupportDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.support.setWhatsapp(
      { numero: dto.numero, mensaje: dto.mensaje, habilitado: dto.habilitado },
      user?.username,
    );
  }
}
