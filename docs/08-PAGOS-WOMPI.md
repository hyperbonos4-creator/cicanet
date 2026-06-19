# 08 · Pagos (Wompi) y reactivación automática

El flujo de pago es el corazón económico de CICANET: **el cliente paga y su servicio vuelve solo, sin empleados.**

## Pasarela: Wompi

- Pasarela colombiana (Bancolombia). Medios: **PSE, tarjetas, Nequi, Bancolombia**.
- Tiene **sandbox** para pruebas y **webhooks** firmados.
- La capa de pagos se diseña **abstracta** (`PaymentProvider`) para añadir ePayco/Bold sin reescribir el dominio.

## Flujo completo

```
1. App: cliente pulsa "Pagar factura"
2. API crea una transacción y devuelve datos de checkout
3. App abre el checkout de Wompi (Web Checkout o Widget)
4. Cliente paga (PSE / tarjeta / Nequi)
5. Wompi → POST /webhooks/wompi  (evento transaction.updated)
6. API verifica la FIRMA del evento  (rechaza si no es válida)
7. API busca la transacción por referencia (idempotencia)
8. Si status = APPROVED:
   - marca factura = PAGADA  (transacción Postgres)
   - registra el pago
   - encola job "reactivar-servicio"  (BullMQ)
   - encola job "generar-comprobante-pdf"
   - encola job "notificar-cliente"
9. Worker reactiva: estado RADIUS = activo + CoA al Mikrotik
10. App recibe evento WebSocket → "Servicio activo"
```

## Idempotencia (crítico)

Wompi puede reenviar el mismo webhook varias veces. Reglas:
- Cada pago se identifica por `referencia_externa` (id de transacción Wompi), **único**.
- Antes de marcar pagada, se verifica si ya se procesó esa referencia.
- Reactivar un servicio ya activo es un **no-op** seguro.

## Verificación de firma

```
firma_esperada = SHA256( concatenación de campos del evento + secreto_eventos )
if (firma_recibida !== firma_esperada) → 401, ignorar evento
```
El secreto de eventos se guarda en variables de entorno, **nunca en el repo**.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/pagos/checkout` | Crea la intención de pago de una factura |
| POST | `/webhooks/wompi` | Recibe la confirmación de Wompi (firmada) |
| GET | `/pagos/:id` | Estado de un pago |
| GET | `/facturas/:id/pdf` | Descarga el comprobante (MinIO) |

## Suspensión por mora (lado inverso)

```
cron diario → busca facturas vencidas (+ días de gracia)
   → encola "suspender-servicio"
   → RADIUS marca al cliente como suspendido
   → Mikrotik lo envía al "walled garden" (página: paga tu factura)
```
Ver [09-INTEGRACION-MIKROTIK.md](09-INTEGRACION-MIKROTIK.md).

## Estados de una factura

```
pendiente ──pago──► pagada
    │
    └─vence (+gracia)─► vencida ──suspende──► (servicio cortado)
                           │
                           └──pago──► pagada ──reactiva──► (servicio activo)
```

## Seguridad y cumplimiento
- No se almacenan datos sensibles de tarjetas (los maneja Wompi — PCI).
- Toda la comunicación por HTTPS.
- Registro de auditoría de cada pago y cambio de estado.
