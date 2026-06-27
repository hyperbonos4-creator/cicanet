import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { config } from '../../config';
import { DemoService } from './demo.service';

/**
 * Endpoint público del demo (sin auth, a propósito): genera una sesión efímera.
 * Protegido por DEMO_MODE (en el ISP real responde 403) + tope de sesiones + TTL.
 */
@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  /** Estado del demo (para que el sitio sepa si mostrar el botón). */
  @Get('status')
  status() {
    return { enabled: config.demo.enabled, ttlMinutes: config.demo.ttlMinutes };
  }

  /** Crea una sesión demo y devuelve credenciales temporales + expiración. */
  @Post('session')
  @HttpCode(201)
  session() {
    return this.demo.createSession();
  }
}
