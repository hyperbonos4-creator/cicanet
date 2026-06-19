import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actor?: string;
  accion: string; // create | update | delete
  entidad: string; // "cliente", ...
  entidadId?: string;
  diff?: unknown;
}

/** Escribe entradas en la bitácora de auditoría. Nunca rompe el request. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor: entry.actor ?? null,
          accion: entry.accion,
          entidad: entry.entidad,
          entidadId: entry.entidadId ?? null,
          diff: (entry.diff ?? undefined) as any,
        },
      });
    } catch (e: any) {
      // La auditoría no debe tumbar la operación de negocio.
      this.logger.warn(`No se pudo registrar auditoría: ${e.message}`);
    }
  }
}
