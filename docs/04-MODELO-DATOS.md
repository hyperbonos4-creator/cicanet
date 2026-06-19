# 04 · Modelo de datos

Modelo conceptual de CICANET. Las geometrías usan **PostGIS** (`geometry`/`geography`). El detalle de tipos y migraciones se cierra en la Fase 2.

## Diagrama de entidades (resumen)

```
Cliente ──< Servicio >── Plan
   │           │
   │           ├──< Factura >──< Pago
   │           └── ubicacion (PostGIS Point)
   │
   └──< DispositivoCliente   (blacklist / red del hogar)

NodoRed (POP/OLT/NAP/CTO) ──< Servicio   (a qué nodo cuelga el cliente)
   │
   └── ubicacion (PostGIS Point)

AreaCobertura (PostGIS Polygon) ── tecnologia (FTTH/HFC/Wireless)

SegmentoFibra (PostGIS LineString) ── conecta NodoRed ↔ NodoRed
```

## Entidades principales

### `clientes`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| documento | text | cédula/NIT, único |
| nombre | text | |
| email | text | |
| telefono | text | |
| direccion | text | |
| ubicacion | geometry(Point,4326) | georreferenciación |
| estado | enum | `activo`, `suspendido`, `retirado` |
| creado_en | timestamptz | |

### `planes`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| nombre | text | ej. "500 Mbps" |
| velocidad_bajada | int | Mbps |
| velocidad_subida | int | Mbps |
| precio | numeric(12,2) | COP |
| tecnologia | enum | `FTTH`, `HFC`, `Wireless` |

### `servicios`
Conecta un cliente con un plan y un nodo de red. Es la "línea" de internet.
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| cliente_id | uuid (FK) | |
| plan_id | uuid (FK) | |
| nodo_id | uuid (FK) | NAP/CTO a la que cuelga |
| usuario_pppoe | text | credencial RADIUS |
| estado | enum | `activo`, `suspendido`, `cortado` |
| fecha_instalacion | date | |

### `facturas`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| servicio_id | uuid (FK) | |
| periodo | text | "2026-06" |
| monto | numeric(12,2) | |
| estado | enum | `pendiente`, `pagada`, `vencida`, `anulada` |
| fecha_emision | date | |
| fecha_vencimiento | date | |
| pdf_url | text | objeto en MinIO |

### `pagos`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| factura_id | uuid (FK) | |
| monto | numeric(12,2) | |
| metodo | enum | `wompi`, `efectivo`, `transferencia` |
| referencia_externa | text | id de transacción Wompi (idempotencia) |
| estado | enum | `aprobado`, `rechazado`, `pendiente` |
| pagado_en | timestamptz | |

### `nodos_red`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| nombre | text | ej. "NAP-023" |
| tipo | enum | `POP`, `OLT`, `NAP`, `CTO`, `SPLITTER` |
| ubicacion | geometry(Point,4326) | |
| capacidad_total | int | puertos |
| capacidad_usada | int | puertos ocupados |
| estado | enum | `online`, `offline`, `degradado` |
| padre_id | uuid (FK) | jerarquía de red |

### `areas_cobertura`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| nombre | text | ej. "Popular 2 - FTTH" |
| poligono | geometry(Polygon,4326) | |
| tecnologia | enum | `FTTH`, `HFC`, `Wireless` |
| estado | enum | `cobertura`, `parcial`, `sin_cobertura` |

### `segmentos_fibra`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| origen_id | uuid (FK nodos_red) | |
| destino_id | uuid (FK nodos_red) | |
| trazado | geometry(LineString,4326) | |

### `dispositivos_cliente`
Para la **blacklist** de la app: dispositivos vistos en la red del hogar.
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| servicio_id | uuid (FK) | |
| mac | text | |
| nombre | text | "iPhone de Ana" |
| bloqueado | bool | si está vetado de la red |
| visto_en | timestamptz | |

### `usuarios` (staff de la ISP) y `roles`
Auth + RBAC. Ver [10-SEGURIDAD.md](10-SEGURIDAD.md).

## Consultas espaciales clave

**¿Esta dirección tiene cobertura?**
```sql
SELECT a.tecnologia, a.estado
FROM areas_cobertura a
WHERE ST_Contains(a.poligono, ST_SetSRID(ST_Point(:lng, :lat), 4326))
ORDER BY a.estado
LIMIT 1;
```

**Clientes afectados si se corta un segmento de fibra** (todos los que cuelgan aguas abajo de un nodo):
```sql
-- recorrido jerárquico desde el nodo afectado hacia las hojas
WITH RECURSIVE descendientes AS (
  SELECT id FROM nodos_red WHERE id = :nodo_afectado
  UNION ALL
  SELECT n.id FROM nodos_red n JOIN descendientes d ON n.padre_id = d.id
)
SELECT c.* FROM clientes c
JOIN servicios s ON s.cliente_id = c.id
WHERE s.nodo_id IN (SELECT id FROM descendientes);
```

**Cobertura calculada por radio de un NAP** (heatmap automático):
```sql
SELECT ST_Buffer(n.ubicacion::geography, 250)::geometry AS area_efectiva
FROM nodos_red n WHERE n.tipo = 'NAP';
```
