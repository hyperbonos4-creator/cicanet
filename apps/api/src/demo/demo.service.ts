import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../config';
import { Role, ROLES, UsersService } from '../users/users.service';

export interface DemoTicket {
  username: string;
  password: string;
  nombre: string;
  ttlMinutes: number;
  expiresAt: string; // ISO
  appUrl: string;
  nota: string;
}

/**
 * Demo público de VISIONYX Telecom (cicanet), mismo patrón que Access: un
 * visitante genera una sesión efímera con credenciales propias y TTL. El
 * barredor elimina los usuarios demo expirados. SOLO opera cuando
 * `config.demo.enabled` (DEMO_MODE=true) — en el ISP real el endpoint responde 403.
 *
 * Nota de aislamiento: cicanet es single-tenant, así que los visitantes comparten
 * el MISMO dataset sembrado (entorno de demostración), a diferencia de Access que
 * aísla por colección de rostros. El despliegue de demo reinicia los datos por cron.
 */
@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DemoService');
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly users: UsersService) {}

  onModuleInit() {
    if (!config.demo.enabled) return;
    const everyMs = Math.max(15, config.demo.sweepSeconds) * 1000;
    this.sweeper = setInterval(() => {
      this.users
        .sweepDemoUsers(config.demo.ttlMinutes)
        .then((n) => { if (n > 0) this.logger.log(`Barridas ${n} sesión(es) demo expirada(s).`); })
        .catch((e) => this.logger.warn(`Fallo al barrer demos: ${e?.message ?? e}`));
    }, everyMs);
    // No bloquear el cierre del proceso por el timer.
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref();
    this.logger.log(`Demo activo: TTL ${config.demo.ttlMinutes}m · máx ${config.demo.maxActiveSessions} sesiones · barrido cada ${config.demo.sweepSeconds}s.`);
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async createSession(): Promise<DemoTicket> {
    if (!config.demo.enabled) {
      throw new ForbiddenException('El modo demo no está habilitado en este entorno.');
    }
    // Limpia expirados antes de evaluar el tope (mantiene el cupo fresco).
    await this.users.sweepDemoUsers(config.demo.ttlMinutes).catch(() => undefined);
    if (this.users.countActiveDemoUsers() >= config.demo.maxActiveSessions) {
      throw new ServiceUnavailableException('Hay demasiadas sesiones de demostración activas en este momento. Intenta de nuevo en unos minutos.');
    }
    const role: Role = (ROLES as string[]).includes(config.demo.role) ? (config.demo.role as Role) : 'admin';
    const { username, password, nombre } = await this.users.createDemoUser(role);
    const expiresAt = new Date(Date.now() + config.demo.ttlMinutes * 60_000).toISOString();
    return {
      username,
      password,
      nombre,
      ttlMinutes: config.demo.ttlMinutes,
      expiresAt,
      appUrl: config.demo.appUrl,
      nota: 'Sesión de demostración temporal. Las credenciales y la actividad se eliminan automáticamente al expirar.',
    };
  }
}
