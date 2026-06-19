# 📖 Glosario

Términos de redes, ISP y de la plataforma CICANET.

## Redes / fibra óptica (FTTH)

| Término | Significado |
|---------|-------------|
| **ISP** | Internet Service Provider — proveedor de internet |
| **WISP** | Wireless ISP — ISP que entrega servicio por radio/inalámbrico |
| **FTTH** | Fiber To The Home — fibra hasta el hogar |
| **HFC** | Híbrido Fibra-Coaxial |
| **POP** | Point of Presence — punto principal de presencia de red |
| **OLT** | Optical Line Terminal — equipo central de la red de fibra (en el POP) |
| **ONU / ONT** | Optical Network Unit/Terminal — equipo en casa del cliente (el "módem" de fibra) |
| **NAP** | Network Access Point — caja de distribución/empalme cerca del cliente |
| **CTO** | Caja Terminal Óptica — caja con splitters de donde se conectan clientes |
| **Splitter** | Divisor óptico: reparte una fibra a varios clientes |
| **PON** | Passive Optical Network — red óptica pasiva (GPON/EPON) |
| **Potencia óptica** | Nivel de señal de luz (dBm); fuera de rango = problema |
| **Fusión** | Empalmar dos fibras (requiere técnico y fusionadora) |

## Acceso y control

| Término | Significado |
|---------|-------------|
| **PPPoE** | Point-to-Point Protocol over Ethernet — autenticación de la sesión del cliente |
| **BNG** | Broadband Network Gateway — el router que concentra y controla las sesiones (aquí, el Mikrotik) |
| **RADIUS** | Protocolo AAA (autenticación, autorización, contabilidad) de clientes |
| **AAA** | Authentication, Authorization, Accounting |
| **CoA** | Change of Authorization (RFC 3576) — cambiar/cortar una sesión activa en caliente |
| **Walled garden** | "Jardín amurallado": morosos solo pueden ver la página de pago |
| **Secret (PPPoE)** | Credencial PPPoE creada manualmente en el Mikrotik (modelo que CICANET reemplaza con RADIUS) |
| **Rate-Limit** | Límite de velocidad aplicado al cliente según su plan |

## Gestión del equipo del cliente

| Término | Significado |
|---------|-------------|
| **CPE** | Customer Premises Equipment — equipo en casa del cliente (router/ONT) |
| **ACS** | Auto Configuration Server — servidor que gestiona los CPE remotamente |
| **TR-069** | Protocolo de gestión remota de CPE (CWMP) |
| **TR-369 (USP)** | Evolución de TR-069 |
| **SNMP** | Protocolo de monitoreo de equipos de red |

## Plataforma / software

| Término | Significado |
|---------|-------------|
| **PostGIS** | Extensión geográfica de PostgreSQL |
| **MVT** | Mapbox Vector Tile — formato de tiles vectoriales |
| **Webhook** | Notificación HTTP que un servicio externo envía al ocurrir un evento (ej. Wompi confirma un pago) |
| **Idempotencia** | Que repetir una operación no cambie el resultado (no duplicar pagos) |
| **CoA** | (ver arriba) clave para reactivar/cortar al instante |
| **DCIM / IPAM** | Gestión de infraestructura física / gestión de direccionamiento IP |
| **NOC** | Network Operations Center — centro de operaciones de red |
| **RBAC** | Role-Based Access Control — permisos por rol |

## Negocio / Colombia

| Término | Significado |
|---------|-------------|
| **Wompi** | Pasarela de pagos colombiana (Bancolombia) |
| **PSE** | Pagos Seguros en Línea (débito desde banco) |
| **DIAN** | Autoridad tributaria (facturación electrónica) |
| **Ley 1581** | Ley de protección de datos personales (habeas data) |
| **GeoMedellín / MEData** | Portales de datos geográficos abiertos de Medellín |
