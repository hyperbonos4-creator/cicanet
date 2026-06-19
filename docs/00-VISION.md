# 00 · Visión

## El problema

Una ISP regional en Medellín alcanzó **~400 clientes en 9 meses** — buen crecimiento — pero opera de forma totalmente manual:

- El control de quién pagó y quién no se lleva a mano.
- Suspender y reactivar clientes se hace **uno por uno desde el Mikrotik**.
- Las facturas no siempre se emiten ni se entregan.
- Cuando un cliente paga, debe esperar a que alguien lo reactive → llamadas y molestia.
- No existe visibilidad de la red: dónde hay cobertura, qué NAP está caída, a cuántos clientes afecta un corte.

Este modelo **no escala**. A 800–1.000 clientes la operación manual colapsa y se pierden clientes por mala cobranza y soporte lento.

## La visión

CICANET es la plataforma que convierte esa operación manual en un **sistema automatizado de extremo a extremo**. El objetivo es que la ISP pueda **crecer de cientos a miles de clientes sin multiplicar el personal administrativo**.

El flujo más valioso del sistema:

```
Cliente paga (app)
      ↓
Pago confirmado (Wompi)
      ↓
Factura generada (PDF)
      ↓
Servicio reactivado (RADIUS/Mikrotik)
      ↓
Comprobante enviado (push + email)
      ↓
Todo sin empleados
```

## Objetivos del producto

1. **Automatizar la cobranza**: facturación mensual automática + corte de morosos + reactivación instantánea al pagar.
2. **Dar autonomía al cliente**: app donde paga, descarga facturas, cambia su clave y gestiona los dispositivos de su red.
3. **Dar visibilidad de la red**: mapa de cobertura en tiempo real e inventario de infraestructura.
4. **Reducir visitas técnicas**: diagnóstico remoto antes de enviar un técnico; el técnico sale solo cuando hay un problema físico real.
5. **Construir sobre algo sólido y open source**: aprovechar los mejores proyectos del ecosistema en lugar de reinventar la rueda.

## Principios de diseño

- **Automatización primero**: si una acción se puede ejecutar sola, no debe requerir un humano.
- **Una sola fuente de verdad**: clientes, red y cobertura viven en un modelo de datos único.
- **Modular**: CRM, facturación, pagos, red, mapa y app son módulos desacoplados, no un monolito gigante.
- **Tiempo real**: el estado de la red y los pagos se reflejan al instante (WebSockets).
- **Apoyarse en gigantes**: estudiar e integrar OpenWISP, NetBox, GenieACS, LibreNMS y FreeRADIUS antes de construir desde cero.

## Qué NO es CICANET (alcance)

- No es un reemplazo del Mikrotik ni de la OLT: los **orquesta**, no los sustituye.
- No pretende competir con ArcGIS: usa PostGIS + MapLibre, suficiente para una ISP profesional sin costos de licencia.
- No empieza por la IA ni el NOC autónomo: eso es fase avanzada. Primero se resuelve cobranza, pagos y visibilidad.

## Métrica de éxito

> Que un cliente pueda pagar a las 11 p.m. un domingo y su internet vuelva en segundos, sin que nadie de la ISP haga nada.

Ver el plan de ejecución en [ROADMAP.md](ROADMAP.md).
