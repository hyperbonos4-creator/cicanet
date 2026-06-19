# 06 · App del cliente (Flutter)

App móvil para **Android e iOS** desde una sola base de código (Flutter). Es la cara visible de CICANET para el usuario final.

## Pantallas

### 1. Login
- Acceso con **documento / email / celular** + contraseña.
- Credenciales entregadas por la ISP en la instalación.
- Recuperación de clave por OTP (SMS/email, vía Redis).

### 2. Cambio de contraseña
- Obligatorio en el primer ingreso.
- Cambio libre desde el perfil en cualquier momento.

### 3. Inicio / Estado del servicio
```
Servicio:      ● Activo
Plan:          500 Mbps
Próximo pago:  15 julio 2026
Saldo:         $0
```
- Estado en **tiempo real** (WebSocket): si paga, pasa a "Activo" al instante.

### 4. Facturas
- Lista de facturas (pagadas/pendientes/vencidas).
- **Descargar PDF** (servido desde MinIO).
- Historial de pagos.

### 5. Pago
- Botón **Pagar** → checkout **Wompi** (PSE, tarjeta, Nequi).
- Al confirmarse: factura pagada → comprobante PDF → servicio reactivado → notificación.
- Detalle del flujo: [08-PAGOS-WOMPI.md](08-PAGOS-WOMPI.md).

### 6. Mis dispositivos (Blacklist)
- Lista de dispositivos detectados en la red del hogar:
```
● iPhone 16          (conocido)
● Samsung TV         (conocido)
● Laptop ASUS        (conocido)
○ Dispositivo desconocido  [ Bloquear ]
```
- Botón **Bloquear** → CICANET envía la instrucción al router del cliente vía **GenieACS** (TR-069).
- ⚠️ **Requisito técnico:** solo funciona si el CPE (router/ONT) del cliente es administrable por TR-069/SNMP. Routers no administrables no soportan esta función. Validar el parque de equipos antes de prometerla.

### 7. Soporte
- Crear ticket.
- (Fase avanzada) Asistente con diagnóstico automático: consulta estado de ONU/OLT/NAP/router/pagos y responde antes de escalar a un humano.

## Arquitectura de la app

```
Flutter (UI)
   │  REST + WSS
   ▼
API NestJS  ──► Auth (JWT + refresh)
            ──► Facturas / Pagos
            ──► Estado del servicio (tiempo real)
            ──► Dispositivos (GenieACS)
   │
Wompi SDK (checkout en la app)
Push: Firebase Cloud Messaging
```

## Requisitos no funcionales
- Tokens JWT con refresh seguro (almacenamiento seguro del dispositivo).
- Funciona offline para *ver* la última info cacheada; las acciones requieren conexión.
- Localización en español (Colombia), moneda COP.

## Notas de seguridad
- Nunca almacenar la contraseña en claro en el dispositivo.
- El bloqueo de dispositivos pasa siempre por el backend (la app no habla directo al router).
- Cumplimiento de habeas data (Ley 1581). Ver [10-SEGURIDAD.md](10-SEGURIDAD.md).
