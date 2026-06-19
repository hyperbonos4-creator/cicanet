# 11 · Infraestructura y despliegue

## Filosofía

> Docker Compose durante los primeros años. **Kubernetes solo cuando el volumen lo justifique**, no antes.

## Servicios base (local / `infra/docker-compose.yml`)

| Servicio | Imagen | Puerto | Rol |
|----------|--------|--------|-----|
| postgres | postgis/postgis:16 | 5432 | DB + geo |
| redis | redis:7 | 6379 | cache, colas |
| minio | minio/minio | 9000/9001 | objetos (PDF) |
| martin | maplibre/martin | 3001 | tiles vectoriales |

Las apps (`api`, `web`) corren con `pnpm dev` en desarrollo y como contenedores en producción.

## Arranque local

```bash
pnpm infra:up      # levanta postgres, redis, minio, martin
pnpm install
pnpm dev           # api + web en modo desarrollo
```

## Entornos

| Entorno | Infra | Datos |
|---------|-------|-------|
| **local** | Docker Compose | seed de prueba |
| **staging** | Docker Compose en VPS | datos realistas anonimizados |
| **production** | Docker Compose / K8s + S3 real | datos reales, backups |

## Variables de entorno (ejemplo)

```
# Base de datos
DATABASE_URL=postgres://cicanet:***@postgres:5432/cicanet
# Redis
REDIS_URL=redis://redis:6379
# MinIO / S3
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=***
S3_SECRET_KEY=***
# Auth
JWT_SECRET=***
JWT_REFRESH_SECRET=***
# Wompi
WOMPI_PUBLIC_KEY=***
WOMPI_PRIVATE_KEY=***
WOMPI_EVENTS_SECRET=***
# RADIUS / Mikrotik
RADIUS_DB_URL=...
MIKROTIK_HOST=...
MIKROTIK_USER=...
MIKROTIK_PASSWORD=***
```
> Se versiona un `.env.example` sin valores reales. El `.env` está en `.gitignore`.

## Despliegue (producción)

1. Build de imágenes (`api`, `web`) en CI.
2. `docker compose -f infra/docker-compose.prod.yml up -d`.
3. Migraciones de DB automáticas en el arranque del `api`.
4. Reverse proxy (Caddy/Traefik/Nginx) con TLS automático.
5. Backups programados de PostgreSQL + objetos de MinIO/S3.

## Observabilidad

- **Prometheus** scrapea métricas de api/workers.
- **Grafana** dashboards (latencia, colas BullMQ, pagos, reactivaciones).
- **Loki** centraliza logs.
- **LibreNMS** para la red física (SNMP).

## Respaldo y recuperación
- Backup diario de PostgreSQL (incluye PostGIS).
- Backup de objetos (facturas/contratos).
- Pruebas periódicas de restauración.

## Escalamiento futuro
- Separar workers (BullMQ) de la API.
- Réplica de lectura de PostgreSQL para reportes/mapa.
- Migrar bus de eventos a NATS.
- Orquestar con Kubernetes cuando haya múltiples nodos/regiones.
