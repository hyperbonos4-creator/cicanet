import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { SupportService } from '../support/support.service';
import { config } from '../config';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly wa: WhatsappService,
    private readonly support: SupportService,
  ) {}

  /** Estado de la sesión + QR de vinculación. Solo admin. */
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  status() {
    return this.wa.getStatus();
  }

  /** Inicia/reanuda la vinculación (genera QR). Solo admin. */
  @Post('connect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  connect() {
    return this.wa.connect();
  }

  /** Desvincula el teléfono. Solo admin. */
  @Delete('session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  logout() {
    return this.wa.logout();
  }

  /** Bandeja: chats con clientes (espejo). Solo admin/operador. */
  @Get('chats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operador')
  chats() {
    return this.wa.listChats();
  }

  /**
   * Contacto de soporte que abre la app del cliente. Prioriza el número
   * vinculado por QR; si no hay vínculo, cae al número configurado manualmente.
   * Requiere sesión (cualquier rol).
   */
  @Get('contact')
  @UseGuards(JwtAuthGuard)
  async contact() {
    const manual = await this.support.getWhatsapp();
    const mensaje = manual.mensaje;
    const escaneado = this.wa.contact(mensaje);
    if (escaneado.habilitado) {
      return {
        habilitado: true,
        fuente: 'whatsapp_vinculado',
        numero: escaneado.numero,
        url: escaneado.url,
        mensaje,
      };
    }
    return {
      habilitado: manual.habilitado,
      fuente: 'numero_manual',
      numero: manual.numero,
      url: manual.url,
      mensaje,
    };
  }

  /**
   * Webhook de Evolution (QR, conexión y mensajes). Público: lo invoca el gateway,
   * no lleva JWT. Protegido por el secreto compartido en el PATH.
   */
  @Post('webhook/evolution/:token')
  @HttpCode(200)
  async webhook(@Param('token') token: string, @Body() payload: any) {
    const expected = config.evolution.webhookSecret;
    if (!expected || token !== expected) {
      throw new ForbiddenException('invalid_webhook_secret');
    }
    await this.wa.handleEvent(payload);
    return { ok: true };
  }
}
