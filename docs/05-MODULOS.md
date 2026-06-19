# 05 · Módulos

CICANET se organiza en módulos desacoplados. Cada uno corresponde a un módulo NestJS en `apps/api` y a su sección en el panel `apps/web`.

## Mapa de módulos

```
              CICANET PLATFORM
                     │
 ┌──────────┬────────┼────────┬───────────┬──────────┐
 │          │        │        │           │          │
 CRM   Facturación  Pagos    Red       Mapa      App Cliente
 │          │        │        │           │          │
 Tickets   PDF     Wompi    Inventario  Cobertura  Portal
                            Monitoreo   Tiempo real Push
```

## 1. CRM (Clientes)
- Alta/edición de clientes, planes y servicios.
- Estado del servicio (activo/suspendido/cortado).
- Historial de interacciones y tickets de soporte.
- Georreferenciación del cliente (alimenta el mapa).

## 2. Facturación
- Generación **automática mensual** de facturas por ciclo (cron → BullMQ).
- Cálculo de IVA, prorrateos y cargos de reconexión.
- Render de **PDF** y almacenamiento en MinIO.
- Estados: pendiente → pagada / vencida → (suspensión por mora).
- Referencia de diseño: Invoice Ninja.

## 3. Pagos
- Integración **Wompi** (PSE, tarjetas, Nequi).
- Webhook firmado e **idempotente**.
- Disparo de reactivación automática al confirmar pago.
- Conciliación y registro de pagos en efectivo/transferencia.
- Capa de pagos abstracta (añadir ePayco/Bold sin reescribir).
- Detalle: [08-PAGOS-WOMPI.md](08-PAGOS-WOMPI.md).

## 4. Red / Infraestructura
- Inventario: POP, OLT, NAP, CTO, splitters, fibra (modelo tipo NetBox).
- Capacidad de puertos por nodo (ocupados/libres).
- Estado en vivo (online/offline/degradado) alimentado por monitoreo.
- Topología y trazados de fibra (PostGIS LineString).
- Integración AAA con **FreeRADIUS** y Mikrotik. Ver [09-INTEGRACION-MIKROTIK.md](09-INTEGRACION-MIKROTIK.md).

## 5. Mapa de cobertura
- Visualización en **tiempo real** sobre Medellín (MapLibre + PostGIS).
- Capas: comunas, barrios, red troncal, NAPs, clientes, cobertura.
- Consulta de cobertura por dirección.
- Detalle: [07-MAPA-COBERTURA.md](07-MAPA-COBERTURA.md).

## 6. App del cliente
- Login, cambio de contraseña.
- Ver y descargar facturas (PDF).
- Pagar desde la app → reactivación automática.
- Estado del servicio y plan.
- Blacklist de dispositivos de la red del hogar.
- Notificaciones push.
- Detalle: [06-APP-CLIENTE.md](06-APP-CLIENTE.md).

## 7. NOC / Monitoreo (fase avanzada)
- Detección de incidentes (nodo offline → clientes afectados).
- Diagnóstico remoto antes de enviar técnico.
- Alertas y escalamiento a tickets.
- Motores: LibreNMS (red) + Prometheus/Grafana/Loki (plataforma).

## 8. Gestión del CPE / ACS (fase avanzada)
- Integración **GenieACS** (TR-069/369).
- Cambio remoto de SSID/clave WiFi.
- Lectura de dispositivos conectados (alimenta la blacklist).
- Reinicio remoto y firmware.

## Dependencias entre módulos

```
CRM ──► Facturación ──► Pagos ──► Red (reactivación)
                                   ▲
Mapa ◄── Red                       │
App  ──► Pagos / Facturación / Red (blacklist)
NOC  ──► Red (estado en vivo)
ACS  ──► App (blacklist / clave WiFi)
```
