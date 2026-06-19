import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

const METODO_A_ACCION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * Interceptor global: registra automáticamente toda mutación (POST/PUT/PATCH/
 * DELETE) en la bitácora de auditoría. Las lecturas (GET) se ignoran.
 *
 * - actor: username del JWT (req.user)
 * - entidad: primer segmento de la ruta tras /api (ej. "clientes")
 * - entidadId: id del resultado o el :id de la URL
 * - diff: el body de la petición (lo que cambió)
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const accion = METODO_A_ACCION[req.method];

    // Solo auditamos mutaciones.
    if (!accion) return next.handle();

    const entidad = this.entidadDeRuta(req);
    const actor = req.user?.username;
    const bodyId = req.params?.id;

    return next.handle().pipe(
      tap((result) => {
        const entidadId =
          (result && (result.id ?? result.codigo)) || bodyId || undefined;
        void this.audit.record({
          actor,
          accion,
          entidad,
          entidadId: entidadId ? String(entidadId) : undefined,
          diff: req.body && Object.keys(req.body).length ? req.body : undefined,
        });
      }),
    );
  }

  /** Deriva la entidad del path: /api/clientes/CLI-1 → "clientes". */
  private entidadDeRuta(req: any): string {
    const path: string = req.route?.path || req.url || '';
    const clean = path.replace(/^\/?api\/?/, '').split('?')[0];
    const seg = clean.split('/').filter(Boolean)[0];
    return seg || 'desconocido';
  }
}
