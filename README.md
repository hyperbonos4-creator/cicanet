<div align="center">

# 🛰️ CICANET Platform

**Plataforma integral de gestión para proveedores de Internet (ISP)**

CRM · Facturación automática · Pagos en línea · Gestión de red · Mapa de cobertura en tiempo real · App del cliente

</div>

---

## ¿Qué es CICANET?

CICANET es el sistema operativo de una ISP moderna. Reemplaza la operación manual desde el Mikrotik por una plataforma que **automatiza el ciclo completo**: el cliente paga desde su app → se confirma el pago → se genera la factura en PDF → se reactiva el servicio → se notifica al cliente. **Sin intervención humana.**

Nace de un caso real: una ISP con ~400 clientes en 9 meses donde *todo se hace a mano*. CICANET convierte ese caos en un sistema que escala de cientos a miles de clientes sin aumentar el personal administrativo en la misma proporción.

## Capacidades principales

| Módulo | Qué hace |
|--------|----------|
| 🗺️ **Mapa de cobertura** | Visualiza en tiempo real dónde hay cobertura (FTTH/parcial/sin servicio), nodos, NAPs y clientes sobre el mapa de Medellín |
| 👥 **CRM** | Gestión de clientes, planes, contratos, tickets |
| 🧾 **Facturación** | Generación automática mensual de facturas + PDF |
| 💳 **Pagos** | Pasarela Wompi → reactivación automática del servicio |
| 📡 **Red / Infraestructura** | Inventario de OLT, NAP, CTO, fibra; estado en vivo |
| 📱 **App del cliente** | Facturas, pago, cambio de clave, blacklist de dispositivos |
| 🛠️ **NOC / Monitoreo** | Detección y diagnóstico de fallas, alertas |

## Stack tecnológico (resumen)

`NestJS` · `Next.js` · `Flutter` · `PostgreSQL + PostGIS` · `Redis + BullMQ` · `Socket.IO` · `MapLibre GL` · `MinIO` · `Wompi` · `FreeRADIUS` · `Docker`

> Detalle y justificación en [`docs/02-STACK.md`](docs/02-STACK.md).

## 📚 Documentación

Toda la columna vertebral del proyecto vive en [`/docs`](docs/):

| Documento | Contenido |
|-----------|-----------|
| [00 · Visión](docs/00-VISION.md) | El problema y qué resuelve CICANET |
| [01 · Arquitectura](docs/01-ARQUITECTURA.md) | Diagramas, monorepo, flujos |
| [02 · Stack](docs/02-STACK.md) | Tecnologías y por qué cada una |
| [03 · Repos de referencia](docs/03-REPOS-REFERENCIA.md) | Los mejores open source por categoría |
| [04 · Modelo de datos](docs/04-MODELO-DATOS.md) | Entidades, relaciones, PostGIS |
| [05 · Módulos](docs/05-MODULOS.md) | Desglose funcional |
| [06 · App del cliente](docs/06-APP-CLIENTE.md) | Especificación de la app móvil |
| [07 · Mapa de cobertura](docs/07-MAPA-COBERTURA.md) | Mapa en tiempo real |
| [08 · Pagos (Wompi)](docs/08-PAGOS-WOMPI.md) | Flujo de pago y reactivación |
| [09 · Integración Mikrotik](docs/09-INTEGRACION-MIKROTIK.md) | RADIUS, corte y reactivación |
| [10 · Seguridad](docs/10-SEGURIDAD.md) | Auth, RBAC, ley de datos |
| [11 · Infraestructura](docs/11-INFRAESTRUCTURA.md) | Docker, despliegue |
| [12 · Infra Docker (dev)](docs/12-INFRA-DOCKER.md) | Stack completo con hot-reload |
| [🗺️ Roadmap](docs/ROADMAP.md) | Plan por fases (checklist vivo) |
| [📖 Glosario](docs/GLOSARIO.md) | Términos de redes e ISP |

## Estructura del repositorio

```
cicanet/
├── apps/
│   ├── api/        → Backend NestJS (API REST + WebSockets)
│   ├── web/        → Panel admin + portal cliente (Next.js)
│   └── mobile/     → App del cliente (Flutter)
├── packages/
│   └── shared/     → Tipos y contratos compartidos
├── infra/          → docker-compose y configuración de infraestructura
└── docs/           → Documentación (columna vertebral)
```

## Arranque rápido (Docker — recomendado)

Un solo comando levanta **todo** el stack (Postgres+PostGIS, Redis, MinIO, Martin, API y Web) con **hot-reload**:

```bash
docker compose up          # o:  make up   /   npm run up
```

Luego abre **http://localhost:3000** → login `admin` / `cicanet2026`.

> Los cambios de código se aplican **solos** (no hay que reconstruir). Solo reconstruye
> (`docker compose up --build`) si cambias dependencias o un `Dockerfile`.
> Detalle completo en [`docs/12-INFRA-DOCKER.md`](docs/12-INFRA-DOCKER.md).

### Sin Docker (apps por separado)

```bash
cd apps/api && npm install && npm run dev   # :4000
cd apps/web && npm install && npm run dev   # :3000
```

---

<div align="center">
<sub>CICANET Platform · Documentación viva — se actualiza a medida que avanzan las fases.</sub>
</div>
