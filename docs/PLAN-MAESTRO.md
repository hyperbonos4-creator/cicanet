# 🎯 Plan Maestro de CICANET

> **Documento vivo y autoritativo de ejecución.** Aquí se prioriza *todo* el trabajo de mayor a menor impacto, anclado al estado real del código (no a intenciones). Cada bloque es entregable, verificable y desbloquea al siguiente.
>
> Reemplaza al `ROADMAP.md` como fuente de prioridad. El ROADMAP queda como bitácora histórica de fases. Los documentos `00`–`12` siguen siendo el detalle de diseño de cada área; aquí se referencian, no se duplican.

**Leyenda de estado:** `⬜ pendiente` · `🟡 en progreso` · `✅ hecho`
**Prioridad:** P0 (cimiento, bloquea todo) → P7 (diferenciadores avanzados).

---

## 0. Estado real hoy (línea base honesta)

| Área | Estado real en código | Brecha |
|------|----------------------|--------|
| Auth + RBAC | ✅ JWT (access/refresh), bcrypt, roles admin/operador/técnico, guards, middleware web | Falta auditoría y rol `cliente` para el portal |
| Mapa + cobertura | ✅ MapLibre, capas, point-in-polygon, límites oficiales GeoMedellín (Popular/Comuna 1) | Datos servidos desde JSON, no desde PostGIS en vivo |
| Infraestructura | ✅ CRUD de activos/fibra (`infra.service`), persistencia **JSON** | No está en Postgres; sin jerarquía OLT→PON→ONU formal |
| Red (nodos/NAP) | ✅ `network.service` + gateway Socket.IO de estado en vivo | Estado simulado; sin SNMP real |
| **Clientes** | 🟡 CRUD completo pero **modelo plano en un solo objeto, persistido en `clientes.json`** | No normalizado (Cliente≠Servicio≠Punto), sin Postgres, sin facturación |
| Postgres/PostGIS | ✅ Esquema Fase 1 (`nodos_red`, `areas_cobertura`, `segmentos_fibra`, `clientes` geo) + seed + Martin | **No hay tablas de servicios/planes/facturas/pagos**; la app no usa Postgres aún (usa JSON) |
| Facturación / Pagos / RADIUS / Portal / App | ⬜ Solo documentado | Sin implementar |

**Conclusión:** el sistema es hoy un **panel de administración con datos en archivos JSON**. El salto crítico es pasar a **Postgres como fuente única de verdad** con un modelo normalizado; sobre eso se montan facturación, RADIUS y pagos. Por eso P0 es la base de datos real.

---

## 1. Decisiones técnicas tomadas (para no quedar en abstracto)

Estas decisiones cierran los "abiertos" del ROADMAP. Se pueden revisar, pero el plan asume estos defaults para ser ejecutable:

| Decisión | Elección | Por qué |
|----------|----------|---------|
| **ORM** | **Prisma** | Type-safe, migraciones versionadas, gran DX con NestJS. PostGIS se maneja con `Unsupported("geometry")` + queries `$queryRaw` para lo espacial. |
| **Fuente de verdad** | **Postgres + PostGIS** (único) | Hoy hay datos repartidos en 4 JSON. Se consolidan. JSON queda solo como semilla de importación. |
| **Control de red** | **FreeRADIUS** + PPPoE, con CoA (RFC 3576) | Estándar para Mikrotik FTTH. El módulo de aprovisionamiento abstrae un *driver* (RADIUS hoy; RouterOS API como complemento). Detalle: [09-INTEGRACION-MIKROTIK.md](09-INTEGRACION-MIKROTIK.md). |
| **Pagos** | **Wompi** primario (PSE/Nequi/tarjeta) tras capa `PaymentProvider` abstracta | Permite añadir ePayco/Bold sin reescribir. Detalle: [08-PAGOS-WOMPI.md](08-PAGOS-WOMPI.md). |
| **Facturación electrónica DIAN** | Vía **Proveedor Tecnológico externo** (Alegra/Factus/Siigo) por API | Requisito legal en Colombia, pero no bloquea el MVP de cobranza. Se modela desde P1, se integra en P3. |
| **Cola/jobs** | **BullMQ sobre Redis** (ya está en el stack) | Generación de facturas, envío de CoA, notificaciones, polling SNMP. |
| **Portal del cliente** | **Segundo área en el mismo Next.js** (rol `cliente`), no app nativa al inicio | Time-to-value. La app Flutter ([06-APP-CLIENTE.md](06-APP-CLIENTE.md)) queda para P6. |
| **Migración de datos** | El módulo Clientes mantiene su **API pública**; cambia el repositorio (JSON → Prisma) por dentro | No rompe el frontend actual mientras migramos. |

---

## 2. Índice de prioridades (mapa de una ojeada)

| # | Bloque | Por qué aquí | Desbloquea | Estado |
|---|--------|--------------|------------|--------|
| **P0** | Cimiento de datos: Prisma + modelo normalizado + migración Clientes + auditoría | Sin esto nada escala ni es confiable | Todo | ⬜ |
| **P1** | Facturación core (planes, ciclos, generación automática, prorrateo, PDF, mora) | Es el dolor #1 de la ISP (cobranza manual) | Pagos, RADIUS, portal | ⬜ |
| **P2** | Aprovisionamiento de red / RADIUS (corte y reconexión automática, walled garden) | Cierra el ciclo: estado en DB → red obedece sola | El flujo estrella | ⬜ |
| **P3** | Pagos Colombia (Wompi/PSE, webhook idempotente, reconexión auto) + DIAN | "Paga a las 11pm y vuelve el internet solo" | Autonomía del cliente | ⬜ |
| **P4** | IPAM + topología OLT/ONU (IP/VLAN automática, jerarquía de red) | Quita errores humanos y habilita el outage map | Outage map, soporte | ⬜ |
| **P5** | Portal de autogestión del cliente (web) | Diferenciador y descarga de soporte | Menos llamadas | ⬜ |
| **P6** | Monitoreo (SNMP/señal óptica) + Outage map en vivo + App nativa | Visibilidad de red y soporte proactivo | NOC | ⬜ |
| **P7** | Diferenciadores: vista 360°, asistente técnico móvil, diagnóstico remoto (ACS/TR-069) | El "wow" que separa del resto | — | ⬜ |

---

## P0 · Cimiento de datos *(bloquea todo)* — ⬜

**Objetivo:** Postgres como fuente única de verdad, con modelo normalizado y auditoría, sin romper el panel actual.

### Por qué primero
Hoy los clientes viven en `clientes.json` con todo plano. El día que un cliente tenga 2 servicios, se mude, o queramos facturar, el modelo se rompe. Facturación, RADIUS y pagos **todos** dependen de un modelo relacional sólido. Es el cimiento.

### Alcance
- Integrar **Prisma** en `apps/api` (`PrismaModule`, `PrismaService`).
- Definir el **schema relacional** (abajo) + migraciones.
- Refactor del `ClientesService`: de array+JSON a repositorio Prisma, **manteniendo su API pública** (controller y `lib/api.ts` del web no cambian de contrato).
- **Separar conceptos**: `Cliente` (persona) · `Servicio` (la línea/suscripción) · `PuntoInstalacion` (dirección + datos técnicos) · `Plan` (catálogo).
- **Máquina de estados** del servicio como transiciones validadas en backend (guard), no campos sueltos.
- **Audit log** vía interceptor NestJS global → tabla `audit_log` (quién, qué, cuándo, antes/después).
- Script de **importación** de `clientes.json` (y `infra-*.json`, `naps.json`) → tablas.

### Modelo de datos (núcleo normalizado)

```
Cliente (persona/empresa)
  └──< Servicio (suscripción: 1 cliente → N servicios)
         ├── Plan            (catálogo: velocidad, precio, IVA)
         ├── PuntoInstalacion (dirección geo + NAP/puerto/ONU/IP/VLAN)
         ├──< Factura ──< Pago
         └── estado (máquina de estados)

Plan ── catálogo de planes comerciales
AuditLog ── todo cambio sensible
Usuario (staff) + rol  [ya existe en auth]
```

- `cliente`: identificación y contacto (documento único, tipo, nombre, emails, teléfonos, tipo residencial/empresarial).
- `servicio`: FK cliente, FK plan, FK punto, `usuario_pppoe`, `estado` (`instalacion_pendiente|activo|suspendido|cortado|retirado`), fechas, contrato.
- `punto_instalacion`: dirección, barrio, comuna, estrato, `ubicacion geometry(Point,4326)`, FK nodo (NAP/CTO), puerto, `onu_serial`, `ip`, `vlan`, tecnología.
- `plan`: nombre, `velocidad_bajada/subida`, `precio`, `iva`, tecnología, activo.
- `audit_log`: actor, acción, entidad, entidad_id, diff JSONB, timestamp.

> El `Cliente` plano de hoy ([domain/types.ts](../apps/api/src/clientes/domain/types.ts)) se descompone en estas entidades. El formulario actual de 4 bloques sigue funcionando: el bloque 1 → `cliente`, bloque 2 → `punto_instalacion`, bloque 3 → `servicio`+`plan`, bloque 4 → `servicio`(contrato/facturación).

### Criterios de aceptación
- `docker compose up` levanta API conectada a Postgres; `npx prisma migrate` aplica el schema.
- El panel Clientes sigue creando/listando/editando igual que hoy, pero los datos están en Postgres.
- Crear un cliente genera filas en `cliente` + `servicio` + `punto_instalacion`.
- Toda transición de estado inválida es rechazada por el backend.
- Cada create/update/delete deja registro en `audit_log`.
- Script de importación migra los datos JSON existentes sin pérdida.

### Esfuerzo: **Alto** · **Sin dependencias** · *empezar aquí*

---

## P1 · Facturación core — ⬜

**Objetivo:** generar y cobrar facturas automáticamente; dejar de llevar la cobranza a mano.

### Alcance
- Catálogo de **planes** (CRUD admin) con precio + IVA.
- **Generación automática** de facturas por ciclo de corte (cron + BullMQ): cada día se emiten las de los servicios cuyo `dia_corte` toca.
- **Prorrateo**: primera factura proporcional a días desde la instalación; prorrateo en cambio de plan a mitad de ciclo.
- **Estados de factura**: `pendiente → pagada | vencida → (dispara suspensión)`. Marcar vencidas por cron.
- **Cargo de reconexión** configurable.
- Render de factura en **PDF** → MinIO (plantilla con identidad CICANET).
- **Dunning** (cobranza): regla `vencida + N días → marcar servicio para suspensión` (la ejecuta P2).
- Panel admin: facturas por cliente/estado, emitir/anular, ver PDF, KPIs de cartera.

### Modelo de datos (añade)
- `factura`: FK servicio, `periodo`, `subtotal`, `iva`, `total`, `estado`, `fecha_emision`, `fecha_vencimiento`, `pdf_url`.
- `pago` (esqueleto, se llena en P3): FK factura, monto, método, `referencia_externa` (idempotencia), estado.
- `config_facturacion`: días de gracia, cargo de reconexión, % IVA por defecto.

### Criterios de aceptación
- Un cron de prueba genera las facturas del día correctamente (con prorrateo en altas nuevas).
- Las facturas vencidas se marcan solas y aparecen en una cola de morosos.
- Se descarga el PDF de una factura desde el panel.
- KPI de ingresos/cartera en el Dashboard sale de facturas reales, no de `tarifa` plana.

### Esfuerzo: **Alto** · **Depende de:** P0 · Detalle: [05-MODULOS.md](05-MODULOS.md) §2

---

## P2 · Aprovisionamiento de red / RADIUS — ⬜

**Objetivo:** que suspender/reactivar sea un cambio en la DB que la red obedece sola. **El mayor salto funcional.**

### Alcance
- **FreeRADIUS** en el stack apuntando a Postgres CICANET (tablas `radcheck`, `radreply`, `radusergroup`, `radacct`).
- Módulo NestJS `RadiusModule` que **sincroniza** estado de `servicio` ↔ tablas RADIUS:
  - servicio activo → grupo con `Mikrotik-Rate-Limit` del plan.
  - servicio suspendido/cortado → grupo **walled garden**.
- **CoA / Disconnect (RFC 3576)** hacia el Mikrotik para cortar/reconectar la sesión activa al instante.
- **Walled garden**: portal "tu servicio está suspendido, paga aquí".
- Driver abstracto de **RouterOS API** (v7 REST / API binaria) para acciones puntuales (reiniciar, leer sesiones).
- Enganche con P1: `factura vencida + gracia` → `servicio.suspender()` → RADIUS + CoA automáticos.

### Criterios de aceptación
- Cambiar el estado de un servicio en el panel corta/reactiva la sesión PPPoE real (lab) en segundos vía CoA.
- Un moroso cae solo en walled garden tras vencer la gracia.
- La velocidad aplicada coincide con el plan del cliente.

### Esfuerzo: **Alto** · **Depende de:** P0, P1 · Detalle: [09-INTEGRACION-MIKROTIK.md](09-INTEGRACION-MIKROTIK.md)

---

## P3 · Pagos Colombia + reactivación automática — ⬜

**Objetivo:** el flujo estrella — *el cliente paga y su internet vuelve solo, sin que nadie de la ISP haga nada.*

### Alcance
- Capa **`PaymentProvider`** abstracta + implementación **Wompi** (sandbox → prod): PSE, Nequi, tarjeta.
- **Webhook firmado e idempotente** (verifica firma, deduplica por `referencia_externa`).
- Flujo: pago confirmado → marca factura `pagada` → `servicio.reactivar()` → CoA (P2) → comprobante (email/push).
- Registro/conciliación de pagos **efectivo/transferencia** (manual, mismo modelo).
- Códigos de pago presencial (Efecty/Su Red) como método alterno (estrato 1–3).
- **Facturación electrónica DIAN** vía PT externo: al marcar pagada (o al emitir), enviar a Alegra/Factus y guardar CUFE.

### Criterios de aceptación
- Pago sandbox Wompi reactiva el servicio end-to-end y envía comprobante.
- Reenvíos del webhook no duplican pagos (idempotencia probada).
- Factura electrónica válida con CUFE generada vía PT.

### Esfuerzo: **Medio-Alto** · **Depende de:** P1, P2 · Detalle: [08-PAGOS-WOMPI.md](08-PAGOS-WOMPI.md)

---

## P4 · IPAM + topología OLT/ONU — ⬜

**Objetivo:** quitar el tecleo manual de IP/VLAN/puerto y modelar la red de verdad (habilita el outage map).

### Alcance
- **IPAM**: entidades `subnet`/`ip_address` (estado libre/asignada/reservada). Servicio `ipam.allocateNext(subnetId)` con **lock en Redis** para evitar colisiones. El alta de servicio toma la siguiente IP libre del pool de su zona/NAP.
- **VLAN pool** por OLT/zona con asignación automática.
- **Jerarquía real**: `OLT → tarjeta → puerto PON → ONU(serial) → servicio`, en vez de campos sueltos. Migra los datos técnicos de `punto_instalacion`.
- Capacidad de puertos por NAP/CTO calculada (ocupados/libres) desde las relaciones, no a mano.
- Backup/versionado de config de equipos (idea **Oxidized**) — opcional.

### Criterios de aceptación
- Crear un servicio asigna IP y VLAN automáticamente sin colisión (probado en concurrencia).
- La ocupación de cada NAP se calcula sola.
- Se puede responder "¿qué clientes cuelgan de esta OLT/PON/NAP?" por consulta.

### Esfuerzo: **Medio** · **Depende de:** P0 · Inspiración: NetBox / phpIPAM ([03-REPOS-REFERENCIA.md](03-REPOS-REFERENCIA.md))

---

## P5 · Portal de autogestión del cliente (web) — ⬜

**Objetivo:** que el cliente vea y pague su factura solo. Descarga de soporte + diferenciador.

### Alcance
- Rol **`cliente`** en auth + área separada en el Next.js (login propio por documento/contrato).
- Ver estado del servicio, plan, próxima factura, historial.
- **Pagar** desde el portal (Wompi, P3) → reactivación automática.
- Descargar facturas (PDF).
- Reportar una falla → crea ticket.

### Criterios de aceptación
- Un cliente entra, ve su deuda, paga y queda reactivado sin intervención de staff.

### Esfuerzo: **Medio** · **Depende de:** P1, P3

---

## P6 · Monitoreo + Outage map + App nativa — ⬜

**Objetivo:** visibilidad de red en vivo y soporte proactivo.

### Alcance
- **Polling SNMP** (worker BullMQ) a OLTs/switches → señal óptica por ONU (Rx/Tx dBm) mostrada por cliente. Inspiración **LibreNMS**.
- **Outage map en vivo**: si una NAP/OLT cae, pintar en rojo todos los clientes aguas abajo (usa la jerarquía de P4 + la consulta recursiva ya diseñada en [04-MODELO-DATOS.md](04-MODELO-DATOS.md)).
- Detección de incidente → lista de clientes/ingresos afectados.
- **App Flutter** del cliente ([06-APP-CLIENTE.md](06-APP-CLIENTE.md)): facturas, pago, estado, push FCM.

### Criterios de aceptación
- Tumbar una NAP en el lab pinta a sus clientes en rojo y lista los afectados.
- La señal óptica de un cliente es visible para soporte.

### Esfuerzo: **Alto** · **Depende de:** P2, P4

---

## P7 · Diferenciadores avanzados — ⬜

- **Vista 360° del cliente**: un solo lugar con servicio + señal en vivo + facturas + tickets + historial (lo que vende UISP).
- **Asistente de instalación móvil** para técnicos: escanear serial ONU, asignar NAP/puerto, activar servicio y disparar aprovisionamiento desde el teléfono.
- **Diagnóstico remoto / ACS TR-069** (GenieACS): cambiar SSID/clave WiFi, leer dispositivos conectados, reinicio remoto, blacklist de dispositivos del hogar ([05-MODULOS.md](05-MODULOS.md) §8).
- **"¿Qué pasa si cae esta NAP?"**: simulación de impacto (clientes + ingresos) para priorizar cuadrillas.

### Esfuerzo: **Alto** · **Depende de:** P4, P6

---

## 3. Orden de implementación recomendado

```
P0 ─► P1 ─► P2 ─► P3        (el ciclo de cobranza-corte-pago: el corazón del negocio)
 │
 └─► P4 ─────────► P6       (red real → monitoreo/outage; en paralelo tras P0)
        P5 (tras P1+P3)
        P7 (al final)
```

**Hito 1 (MVP que paga la luz):** P0 + P1 + P2 + P3 → la ISP factura, corta y reactiva sola. Es la métrica de éxito de la [visión](00-VISION.md).
**Hito 2 (operación profesional):** P4 + P5.
**Hito 3 (NOC + diferenciación):** P6 + P7.

---

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Migrar de JSON a Postgres rompe el panel actual | Mantener API pública del módulo; migrar repositorio por dentro; script de import idempotente |
| RADIUS/CoA depende del hardware real de la ISP | Confirmar PPPoE/RouterOS v6-v7; diseñar driver abstracto; probar en lab antes de prod |
| DIAN es requisito legal | Delegar a PT externo desde P1; no reinventar facturación electrónica |
| Pagos duplicados por reintentos de webhook | Idempotencia por `referencia_externa` + firma verificada |
| Concurrencia en asignación de IP | Lock en Redis en `ipam.allocateNext` |

---

## 5. Pendientes a confirmar con la ISP (no bloquean P0)

- Autenticación de red actual: ¿PPPoE secrets / DHCP+queues / hotspot?
- ¿Uno o varios Mikrotik? Modelo y RouterOS v6/v7 (define API REST nativa y CoA).
- Pasarela y método de cobro reales hoy.
- ¿Parque de ONT compatible con TR-069? (define alcance del ACS/blacklist en P7).
- ¿DIAN dentro del Hito 1 o Hito 2?

---

*Próximo paso: ejecutar **P0**. Al arrancar implementación se crea el desglose de tareas (TaskList) de P0 y se va marcando aquí el avance.*
