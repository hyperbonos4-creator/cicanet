# 🗺️ Roadmap — CICANET

> **La fuente de prioridad ahora es [PLAN-MAESTRO.md](PLAN-MAESTRO.md)** (P0→P7, anclado al estado real del código). Este ROADMAP queda como bitácora histórica de fases y como detalle de lo ya completado en Fases 0–1.

> Checklist vivo. Marcamos `[x]` lo completado a medida que avanzamos. Cada fase entrega algo funcional y demostrable.

**Leyenda:** `[ ]` pendiente · `[~]` en progreso · `[x]` completado

---

## ✅ Fase 0 — Cimientos (documentación + esqueleto)

- [x] Inicializar monorepo (Turborepo) y estructura de carpetas
- [x] `docker-compose` base (Postgres+PostGIS, Redis, MinIO, Martin)
- [x] `.gitignore`, `package.json` raíz, README
- [x] Documentación backbone completa en `/docs`
  - [x] 00 Visión
  - [x] 01 Arquitectura
  - [x] 02 Stack
  - [x] 03 Repos de referencia
  - [x] 04 Modelo de datos
  - [x] 05 Módulos
  - [x] 06 App del cliente
  - [x] 07 Mapa de cobertura
  - [x] 08 Pagos (Wompi)
  - [x] 09 Integración Mikrotik
  - [x] 10 Seguridad
  - [x] 11 Infraestructura
  - [x] Glosario
  - [x] 12 Infra Docker (dev con hot-reload)
- [x] Verificar en GitHub estrellas/última release de los repos de referencia (NetBox ~20k★, LibreNMS ~9.5k★, OpenWISP multi-repo, GenieACS estándar TR-069)
- [x] **Dockerización completa:** `docker compose up` levanta todo el stack con hot-reload
  - [x] Dockerfile API multi-stage (deps/dev/build/prod)
  - [x] Dockerfile Web multi-stage (deps/dev/build/prod)
  - [x] `docker-compose.yml` raíz (infra + api + web), healthchecks, red, volúmenes
  - [x] Makefile + scripts npm (`up`/`down`/`logs`/`reset`) + `.env.example`
  - [x] Sintaxis compose validada (`docker compose config`) · builds api+web verdes
  - [ ] Lanzar `docker compose up` end-to-end *(requiere Docker Desktop encendido — pendiente en este entorno)*

## 🌍 Fase 1 — Mapa de cobertura de Popular 2 *(lo primero a revisar)* — ✅ COMPLETA

### Frontend (web)
- [x] Scaffold `apps/web` (Next.js 14 + Tailwind + identidad CICANET) · build verificado ✓
- [x] Mapa MapLibre con capas conmutables (cobertura · fibra · nodos · clientes)
- [x] Marcadores de NAPs/CTOs con capacidad de puertos + popups
- [x] Áreas de cobertura (FTTH / parcial / sin) con leyenda
- [x] Panel CICANET: métricas, control de capas, detalle de nodo
- [x] El mapa consume datos desde la API (no datos hardcodeados)

### Backend (api)
- [x] Scaffold `apps/api` (NestJS 10) · build verificado ✓
- [x] Endpoints de red protegidos: `bundle`, `nodes`, `stats`
- [x] **Estado en vivo de nodos vía Socket.IO** (`/realtime`, autenticado) · verificado ✓
- [x] **Endpoint y UI "consultar cobertura por punto"** (`POST /network/coverage/check`, point-in-polygon) · verificado ✓

### 🔐 Autenticación (acceso restringido — nada público)
- [x] Login con JWT (access + refresh) + bcrypt · verificado ✓
- [x] RBAC con roles (`admin`, `operador`, `tecnico`) + guards
- [x] Middleware Next.js que protege todas las rutas (redirige a `/login`) · verificado ✓
- [x] Página `/login` con identidad CICANET + logout en el panel

### PostGIS / producción (listo para activar)
- [x] Esquema PostGIS: `nodos_red`, `areas_cobertura`, `segmentos_fibra`, `clientes` (`infra/postgres/init/01-schema.sql`)
- [x] Seed PostGIS de Popular 2 (`02-seed.sql`)
- [x] Martin configurado para tiles vectoriales (`infra/martin/config.yaml`)
- [x] **Importados los límites OFICIALES de la Comuna 1 (12 barrios) desde GeoMedellín** · verificado ✓
  - Barrio **Popular** (código 0103) como zona operativa real (polígono exacto, 1034 vértices)
  - Nodos/clientes/cobertura generados **dentro del polígono real** (point-in-polygon verificado)
  - El mapa enmarca y resalta el barrio real; los 12 barrios se muestran como contexto con etiquetas
  - Fuente: GeoMedellín · "Barrios y Veredas de Medellín" (FeatureServer ArcGIS, WGS84)
- [ ] Conmutar la API de JSON real → consultas PostGIS en vivo *(swap en `network.service.ts` cuando el contenedor esté arriba; el seed SQL ya existe)*

## 🧾 Fase 2 — Clientes + Facturación

- [ ] Modelo y CRUD de clientes, planes, servicios
- [ ] Autenticación (JWT + refresh) + RBAC
- [ ] Generación automática mensual de facturas (cron + BullMQ)
- [ ] Render de factura en PDF → MinIO
- [ ] Panel admin: clientes, facturas, estados
- [ ] Importar los ~400 clientes actuales

## 💳 Fase 3 — Pagos + reactivación automática

- [ ] Integración Wompi (sandbox → producción)
- [ ] Webhook firmado e idempotente
- [ ] FreeRADIUS + Mikrotik (PPPoE) en paralelo a los secrets
- [ ] Corte/reactivación por CoA
- [ ] Walled garden para morosos
- [ ] Flujo completo: pago → factura pagada → PDF → reactivación → notificación

## 📱 Fase 4 — App del cliente (Flutter)

- [ ] Login + cambio de contraseña
- [ ] Ver/descargar facturas
- [ ] Pago desde la app (Wompi)
- [ ] Estado del servicio en tiempo real
- [ ] Notificaciones push (FCM)
- [ ] Blacklist de dispositivos (requiere GenieACS + CPE compatible)

## 🛠️ Fase 5 — NOC / Monitoreo / ACS

- [ ] Integrar LibreNMS (red) + Prometheus/Grafana/Loki (plataforma)
- [ ] Detección de incidentes → clientes afectados
- [ ] Integrar GenieACS (TR-069) para gestión de CPE
- [ ] Diagnóstico remoto / asistente de soporte
- [ ] Reactivación y reinicio automáticos

---

## Decisiones abiertas (a confirmar con la ISP)
- [ ] ¿Autenticación actual: PPPoE secrets / DHCP+queues / hotspot?
- [ ] ¿Un solo Mikrotik o varios? Modelo y versión (RouterOS v6/v7)
- [ ] ¿Cómo cobran hoy? (efectivo / transferencia / link)
- [ ] ¿El parque de routers/ONT soporta TR-069? (define la blacklist)
- [ ] ORM: Prisma vs TypeORM
- [ ] ¿Facturación electrónica DIAN en alcance de Fase 2?
