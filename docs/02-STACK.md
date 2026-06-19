# 02 · Stack tecnológico

Cada elección está justificada. La regla general: **tecnología madura, con comunidad grande, TypeScript de punta a punta donde sea posible, y open source.**

## Resumen

| Capa | Elección | Alternativa considerada |
|------|----------|-------------------------|
| Monorepo | **Turborepo** | Nx |
| Backend / API | **NestJS** (TypeScript) | Express, Fastify solo |
| Web (admin + portal) | **Next.js** + Tailwind + shadcn/ui + TanStack Query | React + Vite (SPA) |
| App móvil | **Flutter** | React Native |
| Base de datos | **PostgreSQL 16 + PostGIS** | MySQL (descartado) |
| Cache / sesiones | **Redis 7** | — |
| Colas / eventos | **BullMQ** (sobre Redis) | NATS (a futuro) |
| Tiempo real | **Socket.IO** | WS nativo, SSE |
| Mapas | **MapLibre GL JS** + Martin | Leaflet |
| Tiles vectoriales | **Martin** (PostGIS → MVT) | Tegola |
| Almacenamiento | **MinIO** (S3) | S3 real en producción |
| Generación PDF | **@react-pdf/renderer** o Puppeteer | PDFKit |
| Auth | **JWT + refresh + RBAC** → Keycloak | Auth0 |
| Pagos | **Wompi** | ePayco, Bold, PayU |
| AAA / control acceso | **FreeRADIUS** | — |
| Router cliente | **GenieACS** (TR-069/369) | FreeACS |
| Monitoreo app | **Prometheus + Grafana + Loki** | — |
| Monitoreo red | **LibreNMS** | Zabbix |
| Contenedores | **Docker + Docker Compose** → Kubernetes | — |

## Justificación por capa

### Backend → NestJS
Framework de Node con arquitectura modular (módulos, providers, DI) ideal para un sistema empresarial que crecerá. Tiene soporte de primera para **WebSockets**, colas, microservicios y validación. TypeScript end-to-end con la web.

### Web → Next.js (en vez de React pelado)
El App Router da SSR, rutas, layouts y buen SEO para el portal del cliente, además de un despliegue muy simple. Con **shadcn/ui + Tailwind** se logra una interfaz administrativa profesional rápido, y **TanStack Query** maneja el estado del servidor con cache y refetch automático.

### Móvil → Flutter
Una sola base de código para **Android + iOS** (y potencialmente web/desktop). Rendimiento nativo, ideal para la app del cliente con mapas, pagos y notificaciones push.

### Datos → PostgreSQL + PostGIS
PostgreSQL es la mejor base relacional open source. **PostGIS** añade tipos y consultas geográficas (`ST_Contains`, `ST_DWithin`) que son el corazón del mapa de cobertura: responder "¿esta dirección tiene cobertura?" es una consulta espacial directa. No se usa MySQL en un proyecto nuevo de esta magnitud.

### Colas → BullMQ (no NATS al inicio)
La facturación mensual, los envíos y las reactivaciones son trabajos en segundo plano. **BullMQ** corre sobre el Redis que ya tenemos, es TS-native y simple de operar. NATS es excelente pero agrega una pieza más; se adopta cuando el sistema se parta en microservicios.

### Mapas → MapLibre GL JS (subimos desde Leaflet)
MapLibre renderiza **tiles vectoriales** con WebGL: más fluido, estilizable y profesional que Leaflet (raster). **Martin** sirve las geometrías de PostGIS directamente como tiles. Leaflet queda como alternativa simple si se necesita.

### Pagos → Wompi
Pasarela colombiana (de Bancolombia), soporta **PSE, tarjetas, Nequi y Bancolombia**. Buena documentación, webhooks confiables y sandbox. Alternativas listas para conectar: ePayco, Bold, PayU.

### Control de acceso → FreeRADIUS
Es la pieza que convierte "suspender un cliente" en **un cambio en la base de datos** en lugar de una edición manual del Mikrotik. Estándar de la industria. Ver [09-INTEGRACION-MIKROTIK.md](09-INTEGRACION-MIKROTIK.md).

### Router del cliente → GenieACS
Servidor ACS open source líder para **TR-069/TR-369**. Habilita gestión remota de routers/ONT compatibles: cambiar SSID/clave, reiniciar, ver dispositivos conectados (la "blacklist") y aplicar firmware. Requiere que el CPE soporte el protocolo.

## Versionado y convenciones

- **Node ≥ 20**, gestor de paquetes **pnpm**.
- TypeScript estricto en api, web y shared.
- Lint + format con ESLint + Prettier; commits con Conventional Commits.
- Migraciones de DB versionadas (Prisma o TypeORM — a definir en Fase 2).

> Los repos open source que estudiamos para no reinventar la rueda están en [03-REPOS-REFERENCIA.md](03-REPOS-REFERENCIA.md).
