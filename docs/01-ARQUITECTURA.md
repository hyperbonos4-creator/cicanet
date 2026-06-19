# 01 · Arquitectura

## Vista general

CICANET es una **plataforma modular** organizada como monorepo. Tres aplicaciones cliente consumen una API central, que a su vez orquesta la base de datos, el almacenamiento, las colas y la red física de la ISP.

```
                        ┌─────────────────────────────────────┐
                        │            CLIENTES (UI)             │
                        ├───────────────┬─────────────────────┤
                        │  Web (Next.js)│   App (Flutter)      │
                        │  Admin+Portal │   Cliente final      │
                        └───────┬───────┴──────────┬──────────┘
                                │  HTTPS / WSS      │
                        ┌───────▼───────────────────▼──────────┐
                        │           API · NestJS                │
                        │  REST + WebSockets (Socket.IO)        │
                        │  Auth · CRM · Facturación · Pagos     │
                        │  Red · Mapa · Notificaciones          │
                        └──┬───────┬────────┬────────┬──────────┘
                           │       │        │        │
              ┌────────────▼┐ ┌────▼────┐ ┌─▼──────┐ ┌▼─────────────┐
              │ PostgreSQL  │ │  Redis  │ │ MinIO  │ │ BullMQ (jobs)│
              │ + PostGIS   │ │ (cache) │ │ (S3)   │ │ colas/eventos│
              └─────────────┘ └─────────┘ └────────┘ └──────────────┘
                           │
              ┌────────────▼─────────────────────────────────────┐
              │              RED FÍSICA DE LA ISP                  │
              │  Mikrotik (BNG/PPPoE) · FreeRADIUS · OLT · GenieACS│
              └───────────────────────────────────────────────────┘
                           ▲
              ┌────────────┴─────────────┐
              │   Integraciones externas  │
              │   Wompi · WhatsApp · SMTP │
              └───────────────────────────┘
```

## Componentes

| Componente | Tecnología | Rol |
|-----------|-----------|-----|
| **apps/api** | NestJS | Cerebro: lógica de negocio, API REST, WebSockets, orquestación |
| **apps/web** | Next.js | Panel administrativo + portal web del cliente |
| **apps/mobile** | Flutter | App del cliente (Android/iOS) |
| **packages/shared** | TypeScript | Tipos, DTOs y contratos compartidos web↔api |
| **PostgreSQL + PostGIS** | DB | Datos de negocio + geometrías (cobertura, nodos) |
| **Redis** | Cache | Sesiones, OTP, tokens, rate-limit |
| **BullMQ** | Colas | Facturación programada, envíos, reactivaciones |
| **MinIO** | Objetos | Facturas PDF, contratos, fotos |
| **Martin** | Tiles | Sirve geometrías PostGIS como tiles vectoriales al mapa |
| **FreeRADIUS** | AAA | Autenticación de clientes y control de acceso |
| **Mikrotik** | BNG | Enrutamiento y aplicación de cortes/reactivaciones |
| **GenieACS** | ACS | Gestión remota de routers/ONT del cliente (TR-069/369) |

## Flujo crítico: pago → reactivación

```
1. Cliente abre la app y pulsa "Pagar"
2. App → Wompi (checkout / tokenización)
3. Wompi procesa el pago
4. Wompi → Webhook → API NestJS  (POST /webhooks/wompi, firma verificada)
5. API: marca la factura como PAGADA  (transacción en Postgres)
6. API encola job en BullMQ: "reactivar-servicio"
7. Worker: cambia el estado del cliente en FreeRADIUS (activo)
   └─ envía CoA al Mikrotik → la sesión PPPoE recupera velocidad
8. API genera el comprobante PDF → lo guarda en MinIO
9. API emite evento WebSocket → la app muestra "Servicio activo"
10. API encola notificación push + email con el comprobante
```

Todo este flujo es **asíncrono y idempotente**: si Wompi reintenta el webhook, no se duplica el pago ni la reactivación.

## Patrón de eventos

CICANET usa un modelo **orientado a eventos** con BullMQ sobre Redis. Acciones que disparan trabajos en segundo plano:

| Evento | Trabajo encolado |
|--------|------------------|
| `factura.vencida` | Suspender servicio (gracia configurable) |
| `pago.confirmado` | Reactivar servicio + generar comprobante |
| `ciclo.facturacion` (cron mensual) | Generar facturas de todos los clientes activos |
| `dispositivo.bloqueado` | Aplicar regla en router del cliente |
| `nodo.offline` (monitoreo) | Crear incidente + notificar NOC |

> Empezamos con **BullMQ** (simple, TS-native). Si en el futuro se separan microservicios, se migra el bus a **NATS** sin cambiar la lógica de dominio.

## Decisiones de arquitectura (ADR resumidos)

- **Monorepo (Turborepo)**: tipos compartidos entre web y api, un solo flujo de CI, despliegue coordinado.
- **NestJS modular, no microservicios al inicio**: un solo deployable, módulos bien separados. Se parte a microservicios solo cuando el volumen lo justifique.
- **PostGIS en la DB principal, no una DB geográfica aparte**: las consultas espaciales (¿esta dirección tiene cobertura?) conviven con los datos de negocio.
- **RADIUS como capa de control**: suspender/reactivar es un cambio en la base de datos, no una edición manual del Mikrotik. Ver [09-INTEGRACION-MIKROTIK.md](09-INTEGRACION-MIKROTIK.md).
- **Tiempo real con Socket.IO**: el mapa y el estado del servicio se actualizan sin recargar.

## Entornos

| Entorno | Uso |
|---------|-----|
| `local` | Docker Compose en la máquina del desarrollador |
| `staging` | Pruebas con datos realistas antes de producción |
| `production` | Operación real de la ISP |

Detalle en [11-INFRAESTRUCTURA.md](11-INFRAESTRUCTURA.md).
