# @cicanet/api — Backend CICANET (NestJS)

API central de la plataforma: **autenticación (JWT + RBAC)**, datos de red/cobertura y **tiempo real (Socket.IO)**.

## Correr en local

```bash
cd apps/api
npm install      # primera vez
npm run dev      # http://localhost:4000/api  (watch)
# o producción:
npm run build && npm start
```

Corre **sin Docker ni base de datos** para la demo (datos semilla en memoria).

## Usuarios semilla

| Usuario  | Contraseña     | Rol        |
|----------|----------------|------------|
| admin    | `cicanet2026`  | admin      |
| operador | `operador2026` | operador   |
| tecnico  | `tecnico2026`  | tecnico    |

## Endpoints

| Método | Ruta | Protegido | Descripción |
|--------|------|-----------|-------------|
| GET  | `/api/health` | no | Estado del servicio |
| POST | `/api/auth/login` | no | `{username,password}` → access + refresh + user |
| POST | `/api/auth/refresh` | no | `{refreshToken}` → nuevos tokens |
| GET  | `/api/auth/me` | sí | Usuario autenticado |
| GET  | `/api/network/bundle` | sí | Todo el mapa (sector, cobertura, fibra, nodos, clientes, stats) |
| GET  | `/api/network/nodes` | sí | Nodos con estado actual |
| GET  | `/api/network/stats` | sí | Métricas del sector |
| POST | `/api/network/coverage/check` | sí | `{lng,lat}` → ¿hay cobertura? + NAP más cercano |

**WebSocket:** namespace `/realtime` (requiere token en `auth.token`). Emite `nodes:update` y `stats:update` cada 3 s.

## Producción

- Variables en `.env` (ver `.env.example`). **Cambiar los secretos JWT.**
- Para usar PostGIS real: levantar `infra/docker-compose.yml` y conmutar `network.service.ts`
  de los datos semilla a consultas SQL (`ST_Contains`, etc. — ver `docs/04-MODELO-DATOS.md`).
