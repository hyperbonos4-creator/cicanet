# 10 · Seguridad y cumplimiento

## Autenticación

- **JWT de acceso** (corta duración) + **refresh token** (rotación segura).
- Refresh tokens almacenados en Redis (revocables).
- OTP para recuperación de clave (SMS/email), con expiración en Redis.
- En el móvil: tokens en almacenamiento seguro del dispositivo (Keychain/Keystore).
- Evolución: migrar a **Keycloak** cuando crezca la base de usuarios y se necesite SSO/roles avanzados.

## Autorización (RBAC)

Roles base:
| Rol | Permisos |
|-----|----------|
| `admin` | Todo |
| `facturacion` | Clientes, facturas, pagos |
| `tecnico` | Red, tickets, instalaciones |
| `vendedor` | Consulta de cobertura, alta de prospectos |
| `cliente` | Solo sus propios datos (app) |

- Permisos a nivel de módulo y de recurso (un cliente solo ve **sus** facturas).
- Guards de NestJS por rol y por propiedad del recurso.

## Protección de datos

- **HTTPS** obligatorio en todo (web, app, webhooks).
- Contraseñas con **hash** fuerte (argon2/bcrypt), nunca en claro.
- Secretos (Wompi, DB, RADIUS) en variables de entorno / gestor de secretos — **nunca en el repo**.
- Datos de tarjetas: los maneja Wompi (PCI-DSS). CICANET no los almacena.
- Cifrado en reposo de la base de datos y backups en producción.

## Cumplimiento legal (Colombia)

- **Ley 1581 de 2012 (Habeas Data)**: tratamiento de datos personales.
  - Política de tratamiento de datos y autorización del titular.
  - Derecho del cliente a consultar, actualizar y suprimir sus datos.
  - Registro de la finalidad del tratamiento.
- **Facturación electrónica DIAN**: la facturación debe poder integrarse con un proveedor tecnológico autorizado (a evaluar en Fase 2).

## Auditoría

- Log de auditoría de acciones sensibles: cambios de estado de servicio, pagos, suspensiones, accesos admin.
- Trazabilidad: quién hizo qué y cuándo.

## Webhooks

- Verificación de **firma** en todos los webhooks entrantes (Wompi).
- Idempotencia para evitar doble procesamiento.
- Lista de IPs/origen permitido cuando el proveedor lo soporte.

## Buenas prácticas de desarrollo
- Dependencias auditadas (sin paquetes abandonados).
- Validación de entrada en todos los endpoints (DTOs + class-validator).
- Rate limiting en endpoints públicos (login, OTP, checkout).
- Principio de menor privilegio en credenciales de DB/servicios.
