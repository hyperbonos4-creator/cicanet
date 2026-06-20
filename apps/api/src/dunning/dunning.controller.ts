import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DunningService } from './dunning.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Cobranza automática (dunning) por WhatsApp. Admin y contador. */
@Controller('dunning')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'contador')
export class DunningController {
  constructor(private readonly dunning: DunningService) {}

  @Get('config')
  getConfig() {
    return this.dunning.getConfig();
  }

  @Post('config')
  @Roles('admin')
  setConfig(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.dunning.setConfig(body, (req as any).user?.username);
  }

  @Get('preview')
  preview() {
    return this.dunning.preview();
  }

  @Post('run')
  @Roles('admin')
  run(@Body() body: { aplicar?: boolean }) {
    return this.dunning.run({ aplicar: body?.aplicar });
  }

  @Get('historial')
  historial(@Query('mes') mes?: string) {
    return this.dunning.historial(mes);
  }
}
