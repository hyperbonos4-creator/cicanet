import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { config } from '../../config';

/**
 * Copiloto de código (SOLO ADMIN). Da acceso de SOLO LECTURA al árbol del
 * proyecto montado en `config.codeRoot` (/workspace:ro en Docker), para que el
 * asistente pueda responder sobre la arquitectura, encontrar archivos, leer
 * código y explicar cómo funciona la plataforma.
 *
 * SEGURIDAD (no negociable):
 * - Nunca sale de la raíz (defensa contra path traversal con rutas resueltas).
 * - Bloquea archivos/carpetas sensibles (.env, secretos, .git, node_modules…).
 * - Redacta valores que parezcan secretos en el contenido devuelto.
 * - Límites de tamaño y de resultados para no saturar el contexto del modelo.
 * Esta herramienta JAMÁS se expone a clientes (ver AgentToolsService.schemas).
 */
@Injectable()
export class ProjectExplorerService {
  private readonly logger = new Logger('ProjectExplorer');
  private readonly root = resolve(config.codeRoot);

  /** Carpetas que nunca se listan ni se leen. */
  private readonly DENY_DIRS = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage',
    '.dart_tool', '.idea', '.vscode', 'Pods', '.gradle', 'ios/.symlinks',
  ]);

  /** Patrón de archivos sensibles (secretos / credenciales / binarios). */
  private readonly DENY_FILE =
    /(^|[\\/])\.env($|\.|[\\/])|\.(pem|key|p12|keystore|jks|crt|pfx)$|(^|[\\/])(id_rsa|id_ed25519|\.npmrc|\.netrc)$/i;

  /** Extensiones de texto que se pueden leer. */
  private readonly TEXT_EXT =
    /\.(ts|tsx|js|jsx|mjs|cjs|dart|json|md|yml|yaml|prisma|sql|env\.example|sh|ps1|html|css|scss|txt|gitignore|dockerfile|conf|toml|xml|plist|gradle|kt|swift)$/i;

  /** Líneas que contienen posibles secretos → se redactan al devolver. */
  private readonly SECRET_LINE =
    /(secret|password|passwd|token|api[_-]?key|private[_-]?key|authorization|bearer|wompi|jwt|client[_-]?secret|integrity)/i;

  get available(): boolean {
    return existsSync(this.root);
  }

  /** Estructura del proyecto (árbol resumido) hasta cierta profundidad. */
  tree(maxDepth = 2): string {
    if (!this.available) return 'workspace no disponible';
    const lines: string[] = [];
    const walk = (dir: string, depth: number, prefix: string) => {
      if (depth > maxDepth) return;
      let entries: string[];
      try {
        entries = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const name of entries) {
        if (this.DENY_DIRS.has(name) || name.startsWith('.git')) continue;
        const abs = resolve(dir, name);
        let isDir = false;
        try { isDir = statSync(abs).isDirectory(); } catch { continue; }
        if (isDir) {
          lines.push(`${prefix}${name}/`);
          if (lines.length < 400) walk(abs, depth + 1, prefix + '  ');
        } else if (depth <= 1) {
          lines.push(`${prefix}${name}`);
        }
      }
    };
    walk(this.root, 0, '');
    return lines.slice(0, 400).join('\n');
  }

  /** Lista el contenido de un directorio relativo a la raíz. */
  listDir(rel: string): { ok: boolean; ruta?: string; entradas?: string[]; mensaje?: string } {
    const abs = this.safeResolve(rel);
    if (!abs) return { ok: false, mensaje: 'Ruta fuera del proyecto o bloqueada.' };
    try {
      if (!statSync(abs).isDirectory()) return { ok: false, mensaje: 'No es un directorio.' };
      const entradas = readdirSync(abs)
        .filter((n) => !this.DENY_DIRS.has(n))
        .map((n) => {
          try { return statSync(resolve(abs, n)).isDirectory() ? `${n}/` : n; } catch { return n; }
        })
        .sort();
      return { ok: true, ruta: this.rel(abs), entradas: entradas.slice(0, 300) };
    } catch (e: any) {
      return { ok: false, mensaje: `No se pudo listar: ${e.message}` };
    }
  }

  /** Lee un archivo de texto (con redacción de secretos y límite de líneas). */
  readFile(rel: string, opts: { desde?: number; hasta?: number } = {}): {
    ok: boolean; ruta?: string; contenido?: string; lineas?: number; truncado?: boolean; mensaje?: string;
  } {
    const abs = this.safeResolve(rel);
    if (!abs) return { ok: false, mensaje: 'Ruta fuera del proyecto o bloqueada.' };
    if (this.DENY_FILE.test(abs)) return { ok: false, mensaje: 'Archivo protegido (posibles secretos): acceso denegado.' };
    if (!this.TEXT_EXT.test(abs)) return { ok: false, mensaje: 'Tipo de archivo no soportado (solo texto/código).' };
    try {
      const st = statSync(abs);
      if (!st.isFile()) return { ok: false, mensaje: 'No es un archivo.' };
      if (st.size > 600_000) return { ok: false, mensaje: 'Archivo demasiado grande (>600 KB).' };
      const all = readFileSync(abs, 'utf8').split('\n');
      const desde = Math.max(1, opts.desde ?? 1);
      const hasta = Math.min(all.length, opts.hasta ?? Math.min(all.length, desde + 399));
      const slice = all.slice(desde - 1, hasta);
      const redactado = slice.map((l) => this.redact(l)).join('\n');
      return {
        ok: true,
        ruta: this.rel(abs),
        contenido: redactado,
        lineas: all.length,
        truncado: hasta < all.length,
      };
    } catch (e: any) {
      return { ok: false, mensaje: `No se pudo leer: ${e.message}` };
    }
  }

  /** Busca un texto/patrón en el código (grep simple, con límites). */
  search(query: string, opts: { glob?: string; maxResultados?: number } = {}): {
    ok: boolean; total: number; resultados: { archivo: string; linea: number; texto: string }[]; mensaje?: string;
  } {
    const q = (query || '').trim();
    if (q.length < 2) return { ok: false, total: 0, resultados: [], mensaje: 'Consulta muy corta.' };
    const max = Math.min(opts.maxResultados ?? 40, 80);
    const globRe = opts.glob ? this.globToRegExp(opts.glob) : null;
    const needle = q.toLowerCase();
    const resultados: { archivo: string; linea: number; texto: string }[] = [];
    let scanned = 0;

    const walk = (dir: string) => {
      if (resultados.length >= max || scanned > 4000) return;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        if (resultados.length >= max) return;
        if (this.DENY_DIRS.has(name) || name.startsWith('.git')) continue;
        const abs = resolve(dir, name);
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (st.isDirectory()) { walk(abs); continue; }
        if (!this.TEXT_EXT.test(abs) || this.DENY_FILE.test(abs)) continue;
        if (globRe && !globRe.test(this.rel(abs))) continue;
        if (st.size > 600_000) continue;
        scanned++;
        let content: string;
        try { content = readFileSync(abs, 'utf8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            resultados.push({ archivo: this.rel(abs), linea: i + 1, texto: this.redact(lines[i]).trim().slice(0, 200) });
            if (resultados.length >= max) break;
          }
        }
      }
    };
    walk(this.root);
    return { ok: true, total: resultados.length, resultados };
  }

  // ---- helpers de seguridad ----

  /** Resuelve una ruta relativa garantizando que queda dentro de la raíz. */
  private safeResolve(rel: string): string | null {
    const clean = (rel || '').replace(/^[/\\]+/, '').trim();
    const abs = resolve(this.root, clean);
    const within = abs === this.root || abs.startsWith(this.root + sep);
    if (!within) return null;
    // Bloquea si cualquier segmento es una carpeta denegada.
    const parts = this.rel(abs).split(/[\\/]/);
    if (parts.some((p) => this.DENY_DIRS.has(p))) return null;
    return abs;
  }

  private rel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/');
  }

  /** Redacta valores que parezcan secretos en una línea de texto. */
  private redact(line: string): string {
    if (!this.SECRET_LINE.test(line)) return line;
    // key=valor  |  "key": "valor"  → conserva la clave, oculta el valor.
    return line.replace(
      /(["']?[\w.-]*(?:secret|password|passwd|token|key|authorization|bearer|integrity)[\w.-]*["']?\s*[:=]\s*)(["']?)([^"'\s,}]+)(\2)/gi,
      (_m, p1, q, _v, q2) => `${p1}${q}«REDACTADO»${q2}`,
    );
  }

  /** Convierte un glob simple (**, *, ?) a RegExp sobre la ruta relativa. */
  private globToRegExp(glob: string): RegExp {
    const esc = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(esc, 'i');
  }
}
