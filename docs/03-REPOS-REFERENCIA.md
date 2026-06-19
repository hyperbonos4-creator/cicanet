# 03 · Repositorios de referencia (open source)

> Filosofía: **no reinventar la rueda.** Por cada dominio identificamos los 3 mejores proyectos open source, estudiamos su modelo y tomamos lo mejor de cada uno — ya sea integrándolo, consumiéndolo vía API o replicando sus ideas de diseño.
>
> ✅ **Popularidad verificada (junio 2026):**
> - **NetBox** — ~20.000+ estrellas (cruzó la marca en 2026), Apache 2.0, ~351 releases, 10 años de desarrollo. El más adoptado del grupo.
> - **LibreNMS** — ~9.500+ estrellas. Fork de Observium; descubre VLANs/dispositivos en vivo (ideal para auditar la red existente).
> - **OpenWISP** — proyecto **multi-repo** (openwisp-controller, openwisp-monitoring, openwisp-radius, openwisp-firmware-upgrader…), por eso no tiene un único conteo de estrellas.
> - **GenieACS** — ACS TR-069 ligero y rápido; el conteo exacto de estrellas no salió en la búsqueda, pero sigue siendo el estándar open source del dominio.
>
> 💡 Dato útil: existe un plugin **netbox-librenms-plugin** que sincroniza datos entre NetBox y LibreNMS — confirma que combinarlos es un patrón real en la industria.

---

## 1. Plataforma WISP/ISP integral

| | Proyecto | Licencia | Qué tomar |
|--|----------|----------|-----------|
| 🥇 | **OpenWISP** | OSS (GPL) | El más completo open source para WISP/ISP. Provisión de red, **openwisp-radius**, monitoreo, captive portal, gestión de firmware y mapa geográfico de dispositivos. Es el proyecto a estudiar a fondo. |
| 🥈 | **UISP** (Ubiquiti) | Gratis (no OSS) | Referencia de UX y flujo operativo de una ISP/WISP. No se integra, se estudia su experiencia. |
| 🥉 | **Splynx** | Comercial | El blueprint de negocio: CRM + facturación + ACS + portal + tickets + inventario. Modelo a imitar funcionalmente. |

**Decisión:** estudiar OpenWISP como base conceptual y de componentes (sobre todo RADIUS y monitoreo); imitar el modelo de negocio de Splynx; inspirarnos en la UX de UISP.

## 2. AAA / control de acceso (RADIUS)

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **FreeRADIUS** | Motor RADIUS estándar de la industria. Lo usamos directamente para autenticar clientes y aplicar cortes/reactivaciones vía CoA. |
| 🥈 | **daloRADIUS** | UI de administración sobre FreeRADIUS. Tomamos ideas de su modelo de usuarios/planes. |
| 🥉 | **RADIUSdesk** | Gestión RADIUS con foco en hotspots/mesh. Ideas de captive portal y vouchers. |

**Decisión:** FreeRADIUS como motor real; la UI la construimos nosotros en el panel admin, inspirada en daloRADIUS.

## 3. Fuente de verdad de red (DCIM / IPAM / topología)

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **NetBox** | El estándar para inventario de red, IPAM, topología y modelado físico (sitios, racks, dispositivos, cables, VLANs, IPs). Su **modelo de datos** es oro. |
| 🥈 | **Nautobot** | Fork de NetBox más extensible (plugins, automatización). Alternativa si necesitamos extender mucho. |
| 🥉 | **phpIPAM** | Gestión de direccionamiento IP sencilla. Ideas para el módulo de IPAM. |

**Decisión:** replicar el modelo de datos de NetBox para nuestro módulo de Red/Infraestructura; opcionalmente integrarlo como sistema externo vía su API.

## 4. Gestión del router/ONT del cliente (TR-069 / TR-369)

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **GenieACS** | Rey open source del mundo TR-069. Gestión remota masiva: SSID, clave, firmware, reinicio, dispositivos conectados. Lo integramos vía su API. |
| 🥈 | **FreeACS** | ACS maduro en Java. Alternativa si se requiere otro enfoque. |
| 🥉 | **OktopUSP** | Soporta TR-369 (USP), la evolución de TR-069. A futuro. |

**Decisión:** GenieACS como ACS. Habilita la **blacklist de dispositivos** y el cambio remoto de clave WiFi desde la app. Depende de que el CPE soporte el protocolo.

## 5. Monitoreo de red

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **LibreNMS** | Descubrimiento automático, alertas y gráficas vía SNMP. Lo consumimos como motor; CICANET lee sus datos. |
| 🥈 | **Zabbix** | Monitoreo empresarial de servidores, switches, UPS, sensores. |
| 🥉 | **Prometheus + Grafana + Loki** | Métricas, dashboards y logs de **nuestras propias apps** (api, workers, DB). |

**Decisión:** LibreNMS para la red física; Prometheus/Grafana/Loki para la plataforma. No construir un gestor SNMP desde cero.

## 6. Automatización del Mikrotik

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **librouteros** (Python) | Cliente maduro de la RouterOS API. Referencia de cómo hablar con el Mikrotik. |
| 🥈 | **go-routeros** | Cliente en Go, robusto para alto rendimiento. |
| 🥉 | **RouterOS REST API** (nativa, v7) | Desde RouterOS v7 hay API REST nativa; útil para acciones puntuales. |

**Decisión:** en NestJS usamos un cliente de la RouterOS API (paquete TS equivalente) inspirado en estos. Preferimos controlar vía **RADIUS/CoA**; la API directa para acciones puntuales (reiniciar, leecturas).

## 7. Mapas / GIS

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **MapLibre GL JS** | Render vectorial con WebGL. Base del mapa de cobertura. |
| 🥈 | **Leaflet** | Alternativa simple (raster) si se necesita algo ligero. |
| 🥉 | **PostGIS + Martin** | PostGIS almacena/consulta geometrías; Martin las sirve como tiles vectoriales a MapLibre. |

**Decisión:** MapLibre GL + PostGIS + Martin. Datos base oficiales desde **GeoMedellín / MEData** (barrios, comunas, manzanas de Medellín).

## 8. Facturación (referencia de diseño)

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **Invoice Ninja** | Facturación completa: plantillas, impuestos, recurrencia, PDF. Ideas de modelo y plantillas. |
| 🥈 | **Crater** | Facturación ligera y limpia (Laravel/Vue). UX sencilla. |
| 🥉 | **Freeside** | Facturación específica para telecom/ISP (legacy, pero conceptos válidos de billing por servicio). |

**Decisión:** construir el módulo de facturación a la medida de la ISP (planes, ciclos, IVA, reconexión), tomando el modelo de datos de Invoice Ninja como referencia.

## 9. Pasarela de pago (Colombia)

| | Proyecto | Qué tomar |
|--|----------|-----------|
| 🥇 | **Wompi** | PSE, tarjetas, Nequi, Bancolombia. Webhooks y sandbox sólidos. **Elección principal.** |
| 🥈 | **ePayco** | Amplia cobertura de medios de pago en Colombia. |
| 🥉 | **PayU / Bold** | Alternativas robustas; Bold con buen flujo móvil. |

**Decisión:** integrar **Wompi** primero; dejar la capa de pagos abstracta para añadir ePayco/Bold sin reescribir.

---

## Los 3 que diseccionaríamos línea por línea

Si solo pudiéramos estudiar tres proyectos a fondo porque ahorran años de desarrollo:

1. **OpenWISP** — el ADN de una plataforma WISP open source completa.
2. **NetBox** — el modelo de datos de infraestructura de red.
3. **GenieACS** — la gestión remota del equipo del cliente.

Entre esos tres está gran parte del ADN técnico de una ISP moderna.
