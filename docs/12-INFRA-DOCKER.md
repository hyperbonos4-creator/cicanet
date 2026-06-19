# 12 · Infraestructura Docker (desarrollo)

> **Objetivo:** un solo comando levanta toda la plataforma, y los cambios de
> código se aplican **solos** (hot-reload) sin reconstruir imágenes.

## Arrancar todo

```bash
docker compose up        # primer plano, ves los logs
# o
docker compose up -d     # en segundo plano
make up                  # equivalente (o: npm run up)
```

La primera vez construye las imágenes de `api` y `web` (1–3 min). Después arranca en segundos.

| Servicio | URL / Puerto | Qué es |
|----------|--------------|--------|
| **web**  | http://localhost:3000 | Panel CICANET (Next.js) |
| **api**  | http://localhost:4000/api | Backend (NestJS) |
| martin   | http://localhost:3001 | Tiles vectoriales (PostGIS) |
| postgres | localhost:5432 | Base de datos + PostGIS |
| redis    | localhost:6379 | Cache / colas |
| minio    | http://localhost:9001 | Almacén S3 (consola) |

Entra a **http://localhost:3000** → login `admin` / `cicanet2026`.

## Hot-reload: cómo funciona

- El código de `apps/api` y `apps/web` se **monta** dentro del contenedor (bind-mount).
- `api` corre `nest start --watch` y `web` corre `next dev`: al guardar un archivo,
  **recompilan y recargan automáticamente**. No hay que reconstruir nada.
- `node_modules` y `.next` viven en volúmenes internos del contenedor (no se mezclan
  con el host ni rompen por diferencias de plataforma).
- Polling activado (`CHOKIDAR_USEPOLLING`, `WATCHPACK_POLLING`) para que el watcher
  detecte cambios en Windows/macOS de forma fiable.

> **Solo necesitas reconstruir la imagen** si cambias dependencias (`package.json`)
> o el `Dockerfile`:
> ```bash
> docker compose up -d --build      # o: make rebuild
> ```

## Comandos útiles

```bash
make logs        # logs de todo (npm run logs)
make api-logs    # solo API
make web-logs    # solo Web
make ps          # estado de servicios
make down        # detener y eliminar contenedores (conserva datos)
make reset       # ⚠️ borra también volúmenes (BD, MinIO)
make sh-api      # shell dentro del contenedor de la API
```

## Configuración

- Todo funciona sin configurar nada (defaults en `docker-compose.yml`).
- Para sobrescribir (contraseñas, secretos JWT): `cp .env.example .env` y edita.
- **Producción:** los `Dockerfile` ya tienen stage `prod` (imágenes optimizadas).
  Se activa apuntando el `target: prod` y compilando — pendiente de `docs/11-INFRAESTRUCTURA.md`.

## Estructura

```
docker-compose.yml          ← stack completo (dev, hot-reload)  ← USAR ESTE
apps/api/Dockerfile         ← multi-stage (deps/dev/build/prod)
apps/web/Dockerfile         ← multi-stage (deps/dev/build/prod)
infra/
  postgres/init/*.sql       ← esquema + seed PostGIS (auto al primer arranque)
  martin/config.yaml        ← config de tiles
  docker-compose.yml        ← solo-infra (sin api/web), uso opcional
.env.example                ← variables (copiar a .env)
Makefile                    ← atajos (make up / down / logs ...)
```
