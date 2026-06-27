import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { HandoffService } from './handoff.service';
import { SupportService } from '../../operations/support/support.service';
import { config } from '../../config';
import type { Request } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly wa: WhatsappService,
    private readonly support: SupportService,
    private readonly handoff: HandoffService,
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

  /** Vinculación por código (alternativa al QR). Solo admin. */
  @Post('pair')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  pair(@Body() body: { numero: string }) {
    return this.wa.pairWithNumber(body?.numero ?? '');
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

  // ---- Handoff bot → asesor (solicitudes de "hablar con un asesor") ----

  /** Solicitudes de asesor (pendientes primero). Admin/operador. */
  @Get('handoffs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operador')
  handoffs() {
    return this.handoff.list();
  }

  /** Conteo de solicitudes pendientes (para el badge del panel). Admin/operador. */
  @Get('handoffs/resumen')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operador')
  handoffsResumen() {
    return this.handoff.resumen();
  }

  /** Atiende una solicitud: la marca atendida y devuelve el wa.me al cliente. */
  @Post('handoffs/:id/atender')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operador')
  atenderHandoff(@Param('id') id: string, @Req() req: Request) {
    return this.handoff.atender(id, (req as any).user?.username);
  }

  /** Cierra/descarta una solicitud. */
  @Post('handoffs/:id/cerrar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operador')
  cerrarHandoff(@Param('id') id: string) {
    return this.handoff.cerrar(id);
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
