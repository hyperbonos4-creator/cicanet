import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AssistantService } from './assistant.service';
import { ChatDto, QuickAskDto } from './dto';
import { QUICK_ACTIONS } from './knowledge';
import { config } from '../config';
import { JwtAuthGuard } from '../auth/guards';

/** Asistente virtual de soporte ("Cica"). Requiere sesión. */
@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Estado del asistente y acciones rápidas iniciales (para la UI). */
  @Get('info')
  info() {
    return {
      nombre: 'Cica',
      ia: !!config.assistant.apiKey,
      modelo: config.assistant.apiKey ? config.assistant.model : null,
      saludo:
        '¡Hola! Soy Cica, el asistente de CICANET. Puedo ayudarte con pagos, cobertura, planes y soporte técnico. ¿En qué te ayudo?',
      acciones: QUICK_ACTIONS,
    };
  }

  /** Conversación completa (recomendado): envía el historial. */
  @Post('chat')
  chat(@Body() dto: ChatDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.assistant.chat(dto.messages, { nombre: user?.nombre });
  }

  /** Atajo de un solo mensaje (sin historial). */
  @Post('ask')
  ask(@Body() dto: QuickAskDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.assistant.chat([{ role: 'user', content: dto.message }], { nombre: user?.nombre });
  }
}
