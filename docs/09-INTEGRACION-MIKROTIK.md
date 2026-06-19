# 09 · Integración Mikrotik + RADIUS

La decisión técnica más importante para que CICANET escale: **suspender o reactivar un cliente debe ser un cambio en la base de datos, no una edición manual del Mikrotik.**

## El problema con el modelo actual

Hoy la ISP usa (muy probablemente) **PPPoE con secrets** definidos en el propio Mikrotik. Suspender = entrar al router y deshabilitar a mano, cliente por cliente. No escala y no se puede automatizar limpio.

## La solución: FreeRADIUS como capa de control

```
Cliente ──PPPoE──► Mikrotik (BNG) ──RADIUS──► FreeRADIUS ──► PostgreSQL
                                                              (estado, plan)
```

- El Mikrotik delega la autenticación y autorización a **FreeRADIUS**.
- FreeRADIUS consulta el estado y el plan del cliente en la base de datos.
- **Suspender** = cambiar un campo en la DB. **Reactivar** = cambiar ese campo.
- La velocidad del plan se aplica con el atributo `Mikrotik-Rate-Limit` desde RADIUS.

## Acciones automatizadas

| Acción | Mecanismo |
|--------|-----------|
| Aplicar plan/velocidad | Atributo RADIUS al autenticar |
| Suspender (mora) | Estado en DB → próxima auth cae en grupo "suspendido" |
| Cortar **al instante** | **CoA/Disconnect** (RFC 3576) al Mikrotik → cae la sesión activa |
| Reactivar al pagar | Estado en DB → CoA → sesión recupera servicio |
| Walled garden | Grupo "suspendido" enruta a una página: *"Tu servicio está suspendido, paga tu factura"* |

## Corte/reactivación en tiempo real (CoA)

No basta cambiar la DB: la sesión PPPoE activa debe enterarse. Se usa **CoA (Change of Authorization)** o **Disconnect-Message** hacia el Mikrotik:

```
Pago confirmado
   → API actualiza estado en DB (activo)
   → API/worker envía CoA al Mikrotik (RouterOS)
   → la sesión del cliente recupera la velocidad del plan
   → el cliente navega en segundos
```

## API directa de RouterOS (acciones puntuales)

Para lo que RADIUS no cubre (reiniciar el router, leer estado, contar sesiones) se usa la **RouterOS API** desde NestJS, inspirada en `librouteros`/`go-routeros`. Desde RouterOS v7 existe también API REST nativa.

## Plan de migración (sin cortar el servicio actual)

1. Levantar **FreeRADIUS** apuntando a la base de CICANET.
2. Configurar el Mikrotik para usar RADIUS en PPPoE (en paralelo a los secrets).
3. Migrar clientes a usuarios PPPoE gestionados por RADIUS por lotes.
4. Activar **walled garden** para suspendidos.
5. Conectar el flujo de pagos (Wompi) → reactivación por CoA.
6. Retirar los secrets manuales.

## Requisitos a confirmar con la ISP
- ¿Autenticación actual: **PPPoE secrets**, DHCP+queues o hotspot?
- ¿Un solo Mikrotik o varios? Modelo (capacidad para RADIUS + CoA).
- ¿RouterOS v6 o v7? (afecta API REST nativa).

> Estas respuestas definen si conviene RADIUS desde el día uno o un atajo para la primera versión.
