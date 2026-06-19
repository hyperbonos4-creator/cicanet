import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { config } from '../config';

export type Role = 'admin' | 'operador' | 'tecnico';

export interface User {
  id: string;
  username: string;
  nombre: string;
  email: string;
  role: Role;
  passwordHash: string;
}

/**
 * Repositorio de usuarios del staff (in-memory para la demo).
 * En producción se reemplaza por la tabla `usuarios` en PostgreSQL — la
 * interfaz pública (findByUsername / findById / validate) no cambia.
 */
@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger('UsersService');
  private users: User[] = [];

  async onModuleInit() {
    // Semilla de usuarios. Las contraseñas se hashean al arrancar (bcrypt).
    const seed: Array<Omit<User, 'passwordHash'> & { password: string }> = [
      {
        id: 'usr-admin',
        username: config.seedAdmin.username,
        nombre: 'Administrador CICANET',
        email: 'admin@cicanet.co',
        role: 'admin',
        password: config.seedAdmin.password,
      },
      {
        id: 'usr-oper',
        username: 'operador',
        nombre: 'Operador NOC',
        email: 'noc@cicanet.co',
        role: 'operador',
        password: 'operador2026',
      },
      {
        id: 'usr-tec',
        username: 'tecnico',
        nombre: 'Técnico de Campo',
        email: 'campo@cicanet.co',
        role: 'tecnico',
        password: 'tecnico2026',
      },
    ];

    this.users = await Promise.all(
      seed.map(async ({ password, ...u }) => ({
        ...u,
        passwordHash: await bcrypt.hash(password, 10),
      })),
    );
    this.logger.log(`Usuarios semilla cargados: ${this.users.map((u) => u.username).join(', ')}`);
  }

  findByUsername(username: string): User | undefined {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  }

  findById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  async validate(username: string, password: string): Promise<User | null> {
    const user = this.findByUsername(username);
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  /** Vista pública del usuario (sin hash). */
  publicView(user: User) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
