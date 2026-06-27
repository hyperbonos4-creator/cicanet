import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { InvoicingService, type EmitirFacturaInput } from './invoicing.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../platform/auth/guards';

/**
 * Facturación electrónica DIAN. Acceso: admin y contador. La emisión contabiliza
 * automáticamente el ingreso en el ledger.
 */
@Controller('invoicing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class InvoicingController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get('health')
  health() {
    return this.invoicing.health();
  }

  @Get('certificado')
  certificado() {
    return this.invoicing.certificateStatus();
  }

  @Get('documentos')
  documentos(@Query('estado') estado?: string, @Query('clienteId') clienteId?: string) {
    return this.invoicing.list({ estado, clienteId });
  }

  @Post('facturas')
  emitir(@Body() dto: EmitirFacturaInput, @Req() req: Request) {
    return this.invoicing.emitirFactura({ ...dto, emitidoPor: (req as any).user?.username });
  }

  /** Parametriza el emisor (CICANET) y la resolución/software DIAN. Solo admin. */
  @Post('config')
  @Roles('admin')
  config(@Body() body: { emisor: Record<string, any>; dian: Record<string, any> }, @Req() req: Request) {
    return this.invoicing.guardarConfig(body.emisor, body.dian, (req as any).user?.username);
  }
}
