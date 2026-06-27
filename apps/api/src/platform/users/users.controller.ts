import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { UsersService, ROLES, type CrearUsuarioInput, type Role } from './users.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

/** Apartado de Usuarios (control del staff). Solo administradores. */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Lista el staff (sin contrasenas). */
  @Get()
  list() {
    return this.users.list();
  }

  /** Roles disponibles (para el selector del formulario). */
  @Get('roles')
  roles() {
    return ROLES;
  }

  @Post()
  crear(@Body() dto: CrearUsuarioInput, @Req() req: Request) {
    return this.users.crear({ ...dto, creadoPor: (req as any).user?.username });
  }

  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() patch: { nombre?: string; email?: string; role?: Role; telefono?: string; cargo?: string; estado?: string; idEmpleado?: string },
  ) {
    return this.users.actualizar(id, patch);
  }

  @Post(':id/password')
  cambiarPassword(@Param('id') id: string, @Body() body: { password: string }) {
    return this.users.cambiarPassword(id, body?.password);
  }

  @Post(':id/estado')
  setEstado(@Param('id') id: string, @Body() body: { estado: string }, @Req() req: Request) {
    return this.users.setEstado(id, body?.estado, (req as any).user?.id);
  }
}
