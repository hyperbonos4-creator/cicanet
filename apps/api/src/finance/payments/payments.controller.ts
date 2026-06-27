import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto';
import { JwtAuthGuard } from '../../platform/auth/guards';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Crea la intención de pago y devuelve los datos del Checkout de Wompi. */
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Body() dto: CreateCheckoutDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.payments.createCheckout({
      facturaId: dto.facturaId,
      montoCents: dto.montoCents,
      descripcion: dto.descripcion,
      email: dto.email,
      creadoPor: user?.username,
    });
  }

  /** Webhook de Wompi (público, verificado por firma). Idempotente. */
  @Post('webhook/wompi')
  @HttpCode(200)
  webhook(@Body() event: any) {
    return this.payments.handleWebhook(event);
  }

  /** Datos de pago manual (Nequi/Bancolombia de la empresa) como alternativa. */
  @Get('manual-info')
  @UseGuards(JwtAuthGuard)
  manualInfo() {
    return this.payments.manualInfo();
  }

  /** Estado de una transacción de pago. */
  @Get(':referencia')
  @UseGuards(JwtAuthGuard)
  status(@Param('referencia') referencia: string) {
    return this.payments.getStatus(referencia);
  }
}
