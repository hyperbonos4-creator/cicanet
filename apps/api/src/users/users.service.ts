import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';

export type Role = 'admin' | 'operador' | 'tecnico' | 'contador';
export const ROLES: Role[] = ['admin', 'operador', 'tecnico', 'contador'];

export interface User {
  id: string;
  username: string;
  nombre: string;
  email: string;
  role: Role;
  passwordHash: string;
  idEmpleado: string | null;
  telefono: string | null;
  cargo: string | null;
  estado: string; // activo | inactivo
}

export interface CrearUsuarioInput {
  username: string;
  nombre: string;
  password: string;
  role: Role;
  email?: string;
  idEmpleado?: string;
  telefono?: string;
  cargo?: string;
  creadoPor?: string;
}

/**
 * Usuarios del STAFF (admin/operador/tecnico/contador). Persisten en la tabla
 * `usuario` (PostgreSQL). Para no romper las lecturas SINCRONAS que hacen `auth`
 * y la estrategia JWT (`findById`/`findByUsername`/`listByRole`), se mantiene un
 * ESPEJO en memoria que se rehidrata desde la BD al arrancar y tras cada cambio.
 * La BD es la fuente de verdad; el espejo es solo cache de lectura.
 */
@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger('UsersService');
  private cache: User[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seed();
    await this.reload();
    this.logger.log(`Usuarios cargados: ${this.cache.map((u) => u.username).join(', ')}`);
  }

  /** Siembra el staff base si la tabla esta vacia (idempotente). */
  private async seed() {
    const count = await this.prisma.usuario.count();
    if (count > 0) return;
    const seed: Array<Omit<CrearUsuarioInput, 'creadoPor'> & { idEmpleado: string }> = [
      { username: config.seedAdmin.username, nombre: 'Administrador CICANET', email: 'admin@cicanet.co', role: 'admin', password: config.seedAdmin.password, idEmpleado: 'EMP-0001', cargo: 'Administrador' },
      { username: 'operador', nombre: 'Operador NOC', email: 'noc@cicanet.co', role: 'operador', password: 'operador2026', idEmpleado: 'EMP-0002', cargo: 'Operador NOC' },
      { username: 'tecnico', nombre: 'Tecnico de Campo', email: 'campo@cicanet.co', role: 'tecnico', password: 'tecnico2026', idEmpleado: 'EMP-0003', cargo: 'Tecnico' },
      { username: 'contadora', nombre: 'Contadora CICANET', email: 'contabilidad@cicanet.co', role: 'contador', password: process.env.SEED_CONTADOR_PASS || 'contadora2026', idEmpleado: 'EMP-0004', cargo: 'Contadora' },
    ];
    for (const s of seed) {
      await this.prisma.usuario.create({
        data: {
          username: s.username, nombre: s.nombre, email: s.email ?? null, role: s.role,
          passwordHash: await bcrypt.hash(s.password, 10), idEmpleado: s.idEmpleado, cargo: s.cargo ?? null,
        },
      });
    }
    this.logger.log('Staff semilla creado en BD.');
  }

  /** Rehidrata el espejo en memoria desde la BD. */
  private async reload() {
    const rows = await this.prisma.usuario.findMany({ orderBy: { creadoEn: 'asc' } });
    this.cache = rows.map((r) => ({
      id: r.id, username: r.username, nombre: r.nombre, email: r.email ?? '', role: r.role as Role,
      passwordHash: r.passwordHash, idEmpleado: r.idEmpleado, telefono: r.telefono, cargo: r.cargo, estado: r.estado,
    }));
  }

  // ---- Lecturas SINCRONAS (desde el espejo) usadas por auth / jwt / ordenes ----

  findByUsername(username: string): User | undefined {
    return this.cache.find((u) => u.username.toLowerCase() === username.toLowerCase());
  }

  findById(id: string): User | undefined {
    return this.cache.find((u) => u.id === id);
  }

  /** Lista usuarios staff por rol (vista publica, sin hash). Para asignacion de OT. */
  listByRole(role: Role) {
    return this.cache.filter((u) => u.role === role && u.estado === 'activo').map((u) => this.publicView(u));
  }

  async validate(username: string, password: string): Promise<User | null> {
    const user = this.findByUsername(username);
    if (!user || user.estado !== 'activo') return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  /** Vista publica del usuario (sin hash). */
  publicView(user: User) {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  // ---- CRUD (apartado de Usuarios, solo admin) ----

  list() {
    return this.cache.map((u) => this.publicView(u));
  }

  private async siguienteIdEmpleado(): Promise<string> {
    const n = await this.prisma.usuario.count();
    return `EMP-${String(n + 1).padStart(4, '0')}`;
  }

  async crear(input: CrearUsuarioInput) {
    const username = input.username?.trim().toLowerCase();
    if (!username || username.length < 3) throw new BadRequestException('El usuario debe tener al menos 3 caracteres.');
    if (!input.nombre?.trim()) throw new BadRequestException('El nombre es obligatorio.');
    if (!input.password || input.password.length < 6) throw new BadRequestException('La contrasena debe tener al menos 6 caracteres.');
    if (!ROLES.includes(input.role)) throw new BadRequestException(`Rol invalido (${ROLES.join(', ')}).`);
    if (await this.prisma.usuario.findUnique({ where: { username } })) throw new ConflictException('Ya existe un usuario con ese nombre de usuario.');
    let idEmpleado = input.idEmpleado?.trim() || (await this.siguienteIdEmpleado());
    if (await this.prisma.usuario.findUnique({ where: { idEmpleado } })) idEmpleado = await this.siguienteIdEmpleado();

    const creado = await this.prisma.usuario.create({
      data: {
        username, nombre: input.nombre.trim(), email: input.email?.trim() || null, role: input.role,
        passwordHash: await bcrypt.hash(input.password, 10), idEmpleado,
        telefono: input.telefono?.trim() || null, cargo: input.cargo?.trim() || null, creadoPor: input.creadoPor ?? null,
      },
    });
    await this.reload();
    return this.publicView(this.findById(creado.id)!);
  }

  async actualizar(id: string, patch: { nombre?: string; email?: string; role?: Role; telefono?: string; cargo?: string; estado?: string; idEmpleado?: string }) {
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (patch.role && !ROLES.includes(patch.role)) throw new BadRequestException('Rol invalido.');
    if (patch.estado && !['activo', 'inactivo'].includes(patch.estado)) throw new BadRequestException('Estado invalido.');
    await this.prisma.usuario.update({
      where: { id },
      data: {
        nombre: patch.nombre?.trim() ?? undefined,
        email: patch.email !== undefined ? (patch.email.trim() || null) : undefined,
        role: patch.role ?? undefined,
        telefono: patch.telefono !== undefined ? (patch.telefono.trim() || null) : undefined,
        cargo: patch.cargo !== undefined ? (patch.cargo.trim() || null) : undefined,
        estado: patch.estado ?? undefined,
        idEmpleado: patch.idEmpleado?.trim() || undefined,
      },
    });
    await this.reload();
    return this.publicView(this.findById(id)!);
  }

  async cambiarPassword(id: string, nueva: string) {
    if (!nueva || nueva.length < 6) throw new BadRequestException('La contrasena debe tener al menos 6 caracteres.');
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    await this.prisma.usuario.update({ where: { id }, data: { passwordHash: await bcrypt.hash(nueva, 10) } });
    await this.reload();
    return { ok: true };
  }

  /** Activa/desactiva un usuario. No permite desactivar al ultimo admin activo. */
  async setEstado(id: string, estado: string, actorId?: string) {
    if (!['activo', 'inactivo'].includes(estado)) throw new BadRequestException('Estado invalido.');
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (estado === 'inactivo' && u.role === 'admin') {
      const adminsActivos = this.cache.filter((x) => x.role === 'admin' && x.estado === 'activo').length;
      if (adminsActivos <= 1) throw new BadRequestException('No puedes desactivar al unico administrador activo.');
      if (id === actorId) throw new BadRequestException('No puedes desactivar tu propia cuenta de administrador.');
    }
    await this.prisma.usuario.update({ where: { id }, data: { estado } });
    await this.reload();
    return this.publicView(this.findById(id)!);
  }
}
