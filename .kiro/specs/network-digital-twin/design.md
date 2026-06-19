# Documento de Diseño — Gemelo Digital de la Red (network-digital-twin)

## Overview

Esta funcionalidad transforma el módulo de Infraestructura de CICANET de un mapa con marcadores de NAP, círculos de cobertura por radio recto y estadísticas, hacia un **Gemelo Digital de la Red FTTH** que modela la red como **topología y trayectos de fibra**. El diseño evoluciona la implementación actual (`apps/api/src/network`, almacenamiento en memoria + JSON y geometría con Turf) hacia un modelo de dominio rico persistido en **PostGIS**, manteniendo la misma estética y arquitectura de UI (`apps/web`, MapLibre + paneles).

El Gemelo Digital se estructura sobre cinco pilares que el resto del sistema consume:

1. **Sitios** — agrupación física de infraestructura (POP, racks, OLT, UPS, cámaras…).
2. **Activos** — ficha universal + campos específicos por tipo, con economía, riesgo y evidencia.
3. **Topología** — relaciones jerárquicas de dependencia (POP → OLT → Splitter → NAP → Cliente).
4. **Cobertura** — área servible calculada desde topología, capacidad y distancia de tendido (no círculos).
5. **Capacidad** — puertos totales/usados/libres con semáforo (verde/amarillo/rojo).

Sobre estos pilares se construyen las capacidades operativas: cinco vistas del mapa, la ficha lateral de activo, hogares potenciales y penetración por sector, el modo construcción (instalable/no instalable + NAP más cercana por ruta) y el análisis de impacto por activo y por fibra.

### Decisiones de diseño clave

| Decisión | Razón |
|----------|-------|
| **Evolucionar el módulo `network` → módulo de dominio `infra`** con servicios separados | El `NetworkService` actual mezcla datos base, runtime y telemetría. El Gemelo Digital necesita servicios cohesivos (Activos, Topología, Capacidad, Cobertura, Construcción, Impacto). |
| **Capa de repositorio abstracta** (`AssetRepository`, etc.) con dos implementaciones: in-memory (demo actual) y PostGIS | Cumple el Requisito 15 sin romper la demo. La lógica de dominio no conoce el almacenamiento. Mismo patrón que `UsersService` ("la interfaz pública no cambia"). |
| **PostGIS para geometrías** (`geometry(Point/LineString/Polygon, 4326)`) servidas vía Martin como tiles vectoriales | Ya previsto en `docs/01`, `docs/04`, `docs/07`. Habilita `ST_Contains`, `ST_DWithin`, clustering y filtrado por bbox (Requisitos 15 y 17). |
| **Campos específicos por tipo en columna `JSONB` (`atributos`)** sobre una tabla `activos` única | El conjunto de tipos {POP, OLT, Switch, …} comparte la ficha universal; los campos por tipo (R4) son heterogéneos. JSONB + validación por esquema discriminado evita 13 tablas. |
| **Topología como `padre_id` autorreferencial** + recorridos recursivos (CTE en PostGIS / DFS en memoria) | Coincide con `nodos_red.padre_id` del modelo de datos actual. El análisis de impacto (R14) es el recorrido descendente. |
| **Semáforo y penetración como funciones puras** sobre los datos persistidos | Son cálculos deterministas y universalmente cuantificables → núcleo de las propiedades de corrección. |
| **RBAC reusando `JwtAuthGuard` + `RolesGuard` existentes** | Los roles `admin`/`operador`/`tecnico` ya existen. Solo se añaden reglas por endpoint (R16). |

### Alcance respecto a la implementación actual

- **Se conserva**: estética del mapa (`CoverageMap.tsx`), `ModuleRail`, geocodificación (`GeoService` + Nominatim), tiempo real (`NetworkGateway`/Socket.IO), guards de auth.
- **Se reemplaza**: el modelo de "círculo de radio recto" (`circle()` en `network.service.ts`) por cobertura calculada; el almacenamiento JSON por repositorios PostGIS; las NAP planas por la ficha universal de activos.
- **Se añade**: Sitios, topología explícita, segmentos de fibra con trazado, sectores, modo construcción, análisis de impacto, economía, riesgo y evidencia.

## Architecture

### Vista de componentes

```
┌──────────────────────────── apps/web (Next.js + MapLibre) ────────────────────────────┐
│  ModuleRail → InfraModule                                                              │
│    ├─ VistaMapaSwitcher   (Cobertura · Capacidad · Incidencias · Activos · Expansión)  │
│    ├─ CoverageMap (evol.)  capas: sitios, activos, fibra, cobertura, capacidad, sectores│
│    ├─ FichaActivo (panel)  General · Topología · Capacidad · Clientes · Historial      │
│    ├─ ModoConstruccion     marcar punto → instalable/no instalable                     │
│    └─ AnalisisImpacto      seleccionar activo/fibra → clientes/NAP/ingresos            │
└───────────────────────────────────────┬────────────────────────────────────────────────┘
                          HTTPS REST + WSS │ (JWT en header / handshake)
┌───────────────────────────────────────▼────────────────────────────────────────────────┐
│                         apps/api (NestJS) — módulo `infra`                                │
│  Controllers (RBAC):  AssetController · SiteController · FiberController ·                 │
│                       SectorController · MapController · ConstructionController ·         │
│                       ImpactController                                                    │
│  Domain Services (lógica pura + orquestación):                                            │
│    AssetService · SiteService · TopologyService · CapacityService ·                       │
│    CoverageService · SectorService · ConstructionService · ImpactService ·                │
│    EconomicsService · EvidenceService                                                     │
│  Pure helpers:  capacity.ts (semáforo) · topology.ts (chain/descendants/cycle) ·          │
│                 penetration.ts · construction.ts (feasibility)                            │
│  Repositories (interfaz):  AssetRepository · SiteRepository · FiberRepository ·           │
│                            SectorRepository · CoverageRepository                          │
│        ├─ InMemory*Repository   (demo, evoluciona los .json actuales)                     │
│        └─ Postgis*Repository     (TypeORM + PostGIS, producción)                          │
│  Realtime:  InfraGateway (evol. NetworkGateway) — estado de activos en vivo               │
└───────────────────────────────────────┬────────────────────────────────────────────────┘
            ┌───────────────────────────┼───────────────────────────┐
   ┌────────▼────────┐         ┌─────────▼─────────┐        ┌────────▼────────┐
   │ PostgreSQL +    │         │  Martin (MVT)     │        │  MinIO (S3)     │
   │ PostGIS         │◄────────│  tiles vectoriales│        │  fotos / docs   │
   │ activos, sitios,│         │  desde PostGIS    │        │  de evidencia   │
   │ fibra, cobertura│         └───────────────────┘        └─────────────────┘
   │ sectores        │
   └─────────────────┘
```

### Flujo: render de una Vista_Mapa para un área visible (Requisitos 10 y 17)

```
1. El operador selecciona una Vista_Mapa y/o mueve el mapa.
2. web → GET /infra/map/{vista}?bbox=minLng,minLat,maxLng,maxLat&zoom=z
3. MapController valida el bbox y delega en MapService.
4. MapService consulta el repositorio filtrando por contención espacial (ST_Contains / ST_Intersects con el bbox).
5. Si el conteo > 1000 → devuelve representaciones agrupadas (clusters) en vez de activos individuales.
6. Cada vista proyecta los datos: Capacidad colorea por semáforo, Incidencias filtra estados de falla, etc.
7. La respuesta es GeoJSON/MVT; MapLibre conserva centro y zoom (no se hace fitBounds al cambiar de vista).
```

### Flujo: modo construcción (Requisito 13)

```
1. El operador marca un punto P en el mapa (Modo_Construccion).
2. web → POST /infra/construction/evaluate { lng, lat }
3. ConstructionService:
   a. Busca NAPs candidatas dentro de un radio razonable (ST_DWithin).
   b. Para cada candidata calcula la Distancia_Tendido por rutas (no línea recta).
   c. Elige la NAP de menor Distancia_Tendido.
   d. Evalúa viabilidad: libres ≥ 1 AND distancia ≤ distancia_max de la NAP.
4. Devuelve { nap, distanciaTendido, puertosLibres, costoEstimado, tiempoEstimado, resultado, causa? }.
```

### Estrategia de persistencia (Requisito 15)

- Migraciones versionadas (TypeORM) crean las tablas con columnas `geometry(...,4326)` e índices `GIST`.
- La contención espacial (R15.5) se resuelve con `ST_Contains`/`ST_Intersects` en SQL; la implementación in-memory usa Turf `booleanPointInPolygon` (como hoy) para mantener equivalencia de comportamiento y permitir pruebas sin base de datos.
- Martin sirve `activos`, `segmentos_fibra`, `areas_cobertura` y `sectores` como tiles vectoriales para las capas estáticas; el estado en vivo sigue por Socket.IO.

## Components and Interfaces

### Backend — Servicios de dominio

**AssetService** — ficha universal, economía, riesgo, evidencia y campos por tipo (R1–R5).
```typescript
interface AssetService {
  create(input: CreateAssetInput, actor: Actor): Promise<Asset>;   // valida tipo + GPS (R1.7)
  update(id: string, patch: Partial<CreateAssetInput>, actor: Actor): Promise<Asset>;
  markInstalled(id: string, actor: Actor): Promise<Asset>;          // exige ≥1 foto (R3.2)
  get(id: string): Promise<AssetDetail>;                            // incluye fotos, docs, riesgo (R3.4, R5.2)
  isWarrantyExpired(asset: Asset, now: Date): boolean;              // R2.3
}
```

**TopologyService** — relaciones de dependencia (R7) y soporte a impacto (R14).
```typescript
interface TopologyService {
  setParent(assetId: string, parentId: string | null): Promise<void>; // rechaza ciclos (R7.4)
  ancestors(assetId: string): Promise<Asset[]>;   // cadena ascendente hasta el POP (R7.2)
  descendants(assetId: string): Promise<Asset[]>; // subárbol descendiente (R7.3)
  wouldCreateCycle(assetId: string, parentId: string): Promise<boolean>;
}
```

**CapacityService** — puertos y semáforo (R9), consumido por la vista Capacidad y la ficha.
```typescript
type Semaforo = 'verde' | 'amarillo' | 'rojo';
interface CapacityService {
  freePorts(nap: Nap): number;                 // total - usados (R9.1)
  semaphore(nap: Nap): Semaforo;               // umbrales 75% / 100% (R9.2–9.4)
  setUsedPorts(napId: string, usados: number): Promise<Nap>; // rechaza usados>total (R9.5)
}
```

**SectorService** — hogares potenciales y penetración (R12).
```typescript
interface SectorService {
  create(input: { nombre: string; hogaresEstimados: number }): Promise<Sector>;
  connectedHouseholds(sectorId: string): Promise<number>;       // clientes activos (R12.2)
  penetration(sectorId: string): Promise<number | null>;        // % o null si estimados=0 (R12.3, R12.4)
}
```

**ConstructionService** — modo construcción (R13).
```typescript
interface ConstructionService {
  evaluate(point: LngLat): Promise<ConstructionResult>;
}
interface ConstructionResult {
  nap: { id: string; nombre: string };
  distanciaTendido: number;       // metros por ruta
  puertosLibres: number;
  costoEstimado: number;
  tiempoEstimado: number;         // horas/días
  resultado: 'Instalable' | 'No instalable';
  causa?: 'sin_puertos' | 'fuera_de_alcance';
}
```

**ImpactService** — análisis de impacto por activo y fibra (R14).
```typescript
interface ImpactService {
  byAsset(assetId: string): Promise<AssetImpact>;       // clientes dependientes (R14.1, R14.4)
  byFiber(segmentId: string): Promise<FiberImpact>;     // longitud, clientes, NAP, ingresos (R14.2)
  monthlyRevenue(clientIds: string[]): Promise<number>; // suma de planes (R14.3)
}
```

**SiteService**, **FiberService**, **CoverageService**, **EconomicsService**, **EvidenceService** completan los pilares (R6, R8, R10.1, R2.2, R3).

### Backend — Controllers y RBAC (Requisito 16)

Todos los endpoints exigen `JwtAuthGuard`. La autorización por rol sigue la matriz:

| Operación | admin | operador | tecnico | anónimo |
|-----------|:-----:|:--------:|:-------:|:-------:|
| Leer mapa / fichas (GET) | ✅ | ✅ | ✅ | ❌ (401) |
| Crear/editar/eliminar activo, sitio, fibra, sector | ✅ | ✅ | ❌ (403) | ❌ |
| Registrar evidencia / evento de mantenimiento | ✅ | ✅ | ✅ | ❌ |
| Eliminar activo/sitio/fibra/sector | ✅ | ✅ | ❌ (403) | ❌ |

Se reutiliza `@Roles('admin','operador')` para mutaciones y un decorador `@Roles('admin','operador','tecnico')` para evidencia/mantenimiento. La lectura solo requiere `JwtAuthGuard`.

### Frontend — Componentes

- **VistaMapaSwitcher**: selector de las cinco vistas; al cambiar, NO reinicia la cámara (R10.6) — se elimina el `fitBounds` automático en cambios de vista, conservando `map.getCenter()`/`map.getZoom()`.
- **CoverageMap** (evolución): nuevas fuentes/capas para sitios, segmentos de fibra (LineString con trazado real, no recta POP→NAP), cobertura calculada y sectores; capa de capacidad coloreada por semáforo.
- **FichaActivo**: panel lateral con secciones General, Topología (solo NAP: cadena POP/OLT/Splitter/NAP), Capacidad (NAP), Clientes (NAP) e Historial (R11).
- **ModoConstruccion** y **AnalisisImpacto**: overlays que consumen `/infra/construction/evaluate` e `/infra/impact/*`.

### Contrato REST (resumen)

```
GET    /infra/map/:vista?bbox=&zoom=        # vistas del mapa, filtrado por bbox + clustering (R10, R17)
GET    /infra/assets/:id                    # ficha de activo (R11, R3.4, R5.2)
POST   /infra/assets                        # crear activo (R1, R4)         [admin, operador]
PATCH  /infra/assets/:id                    # editar activo                 [admin, operador]
POST   /infra/assets/:id/install            # marcar instalado (exige foto) [admin, operador]
POST   /infra/assets/:id/photos             # adjuntar evidencia            [admin, operador, tecnico]
PUT    /infra/assets/:id/parent             # definir padre (anti-ciclo)    [admin, operador]
GET    /infra/assets/:id/topology           # ancestros + descendientes (R7)
GET    /infra/assets/:id/impact             # impacto por activo (R14.1)
DELETE /infra/assets/:id                    # eliminar                      [admin, operador]
POST   /infra/sites · GET /infra/sites/:id  # sitios (R6)
POST   /infra/fiber · GET /infra/fiber/:id/impact  # fibra + impacto (R8, R14.2)
POST   /infra/sectors · GET /infra/sectors/:id     # sectores + penetración (R12)
POST   /infra/construction/evaluate         # modo construcción (R13)
PATCH  /infra/naps/:id/capacity             # puertos usados (valida <= total) [admin, operador]
```

## Data Models

### Modelo de dominio (TypeScript)

```typescript
type AssetType =
  | 'POP' | 'OLT' | 'Switch' | 'Router' | 'NAP' | 'Splitter'
  | 'UPS' | 'Servidor' | 'Camara' | 'Fibra' | 'Empalme' | 'ONU' | 'Cliente';

type AssetStatus = 'Activo' | 'Inactivo' | 'Mantenimiento' | 'Retirado' | 'Dañado';
type OwnershipRegime = 'Arrendado' | 'Comodato' | 'Tercero';
type MonitorProtocol = 'SNMP' | 'API' | 'SSH';

// Ficha universal (R1)
interface Asset {
  id: string;
  tipo: AssetType;                       // R1.1 (enum cerrado)
  marca?: string; modelo?: string; serie?: string;   // R1.2
  direccion?: string; barrio?: string; comuna?: string; ciudad?: string;
  ubicacion: { lng: number; lat: number };           // R1.3 (obligatoria)
  estado: AssetStatus;                   // R1.4 (enum cerrado)
  propio: boolean;                       // R1.5
  regimen?: OwnershipRegime;             // R1.5 (requerido si !propio)
  fechaInstalacion?: string; proveedor?: string;     // R1.6
  gestion?: { ip: string; puerto: number; protocolos: MonitorProtocol[] }; // R1.8
  economia?: Economics;                  // R2
  riesgo?: Risk;                         // R5
  sitioId?: string;                      // R6.2
  padreId?: string | null;               // R7.1
  instalado: boolean;
  atributos: TypeAttributes;             // R4 (discriminado por `tipo`)
  fotos: PhotoRef[];                     // R3
  documentos: DocRef[];                  // R3
  historial: AssetEvent[];               // R11.6
}

interface Economics {                    // R2.1
  costoCompra: number; costoInstalacion: number; proveedor?: string;
  fechaCompra?: string; fechaFinGarantia?: string;
}
interface Risk {                         // R5.1
  expuestoRobo: boolean; expuestoInundacion: boolean; energiaRegulada: boolean;
}
type PhotoCategory = 'vista_general' | 'frontal' | 'placa_serial' | 'instalacion'; // R3.1
interface PhotoRef { id: string; categoria: PhotoCategory; url: string; }
interface DocRef { id: string; url: string; nombre?: string; }
interface AssetEvent {                   // R11.6
  tipo: 'instalacion' | 'mantenimiento' | 'cambio_puerto' | 'incidencia';
  fecha: string; detalle?: string; actor?: string;
}

// Campos específicos por tipo (R4) — unión discriminada almacenada en JSONB
type TypeAttributes =
  | { tipo: 'OLT'; puertosPon: number; puertosSfp: number; ip: string; firmware: string; capacidadOnus: number }   // R4.1
  | { tipo: 'Router'; ip: string; firmware: string; proveedorInternet: string }                                    // R4.2
  | { tipo: 'Switch'; puertos: number; puertosPoe: number; velocidad: string; capacidadSwitching: string }         // R4.3
  | { tipo: 'UPS'; capacidadVa: number; autonomia: number; baterias: number; ultimoCambioBateria?: string }        // R4.4
  | { tipo: 'Servidor'; cpu: string; ramGb: number; discoGb: number; so: string }                                  // R4.5
  | { tipo: 'Fibra'; modo: 'monomodo' | 'multimodo'; hilos: 12|24|48|96|144; longitud: number; origenId: string; destinoId: string } // R4.6
  | { tipo: 'Empalme'; fibrasFusionadas: number; fechaFusion?: string; tecnico?: string }                          // R4.7
  | { tipo: 'NAP'; codigo: string; puertosTotal: number; puertosOcupados: number;
      altura?: number; soporte: 'poste' | 'fachada' | 'gabinete';
      distanciaMax?: number; poligonoComercial?: Polygon; calles?: string[] }                                      // R4.8, R13.5
  | { tipo: 'POP' | 'Camara' | 'ONU' | 'Cliente' | 'Splitter'; [k: string]: unknown };

interface Nap {                          // proyección de un Asset tipo NAP para capacidad
  id: string; puertosTotal: number; puertosOcupados: number;
  distanciaMax?: number; ubicacion: { lng: number; lat: number };
}

interface Site {                         // R6
  id: string; nombre: string; ubicacion: { lng: number; lat: number };
  activosIds: string[];
}

interface FiberSegment {                 // R8, R15.3
  id: string; origenId: string; destinoId: string;
  longitud: number; trazado: LineString;
}

interface CoverageArea {                 // R10.1, R15.4
  id: string; nombre: string; estado: 'cobertura' | 'parcial' | 'sin_cobertura';
  poligono: Polygon;
}

interface Sector {                       // R12
  id: string; nombre: string; hogaresEstimados: number;
}

type Actor = { id: string; role: 'admin' | 'operador' | 'tecnico' };
type LngLat = { lng: number; lat: number };
type Polygon = number[][][];   // anillos [ [ [lng,lat], ... ] ]
type LineString = number[][];  // [ [lng,lat], ... ]
```

### Esquema PostGIS (Requisito 15)

```sql
-- R15.1, R15.2: activos con punto 4326
CREATE TABLE activos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          text NOT NULL CHECK (tipo IN
                ('POP','OLT','Switch','Router','NAP','Splitter','UPS',
                 'Servidor','Camara','Fibra','Empalme','ONU','Cliente')),
  marca text, modelo text, serie text,
  direccion text, barrio text, comuna text, ciudad text,
  ubicacion     geometry(Point, 4326) NOT NULL,          -- R1.3, R1.7
  estado        text NOT NULL CHECK (estado IN
                ('Activo','Inactivo','Mantenimiento','Retirado','Dañado')),
  propio        boolean NOT NULL DEFAULT true,
  regimen       text CHECK (regimen IN ('Arrendado','Comodato','Tercero')),
  fecha_instalacion date, proveedor text, instalado boolean NOT NULL DEFAULT false,
  sitio_id      uuid REFERENCES sitios(id),
  padre_id      uuid REFERENCES activos(id),             -- R7.1 (topología)
  economia      jsonb, riesgo jsonb, gestion jsonb,
  atributos     jsonb NOT NULL DEFAULT '{}'::jsonb,       -- R4 (campos por tipo)
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activos_ubicacion ON activos USING GIST (ubicacion);  -- R17: bbox
CREATE INDEX idx_activos_padre ON activos (padre_id);                  -- R7/R14: recorridos

CREATE TABLE sitios (                                     -- R6
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  ubicacion geometry(Point, 4326) NOT NULL                -- R6.1, R15.2
);

CREATE TABLE segmentos_fibra (                            -- R8
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen_id uuid NOT NULL REFERENCES activos(id),
  destino_id uuid NOT NULL REFERENCES activos(id),
  longitud numeric(12,2) NOT NULL,
  trazado geometry(LineString, 4326) NOT NULL,            -- R8.1, R15.3
  CHECK (origen_id <> destino_id)                         -- R8.4
);
CREATE INDEX idx_fibra_trazado ON segmentos_fibra USING GIST (trazado);

CREATE TABLE areas_cobertura (                            -- R10.1
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('cobertura','parcial','sin_cobertura')),
  poligono geometry(Polygon, 4326) NOT NULL               -- R15.4
);
CREATE INDEX idx_cobertura_poligono ON areas_cobertura USING GIST (poligono);

CREATE TABLE sectores (                                   -- R12
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  hogares_estimados int NOT NULL CHECK (hogares_estimados >= 0)
);
```

### Reglas e invariantes de datos

- **Activo válido**: `tipo` ∈ conjunto cerrado y `ubicacion` presente (R1.1, R1.3, R1.7).
- **Propiedad**: si `propio = false` entonces `regimen` ∈ {Arrendado, Comodato, Tercero} (R1.5).
- **NAP**: `0 ≤ puertosOcupados ≤ puertosTotal` (R9.5); `puertosLibres = puertosTotal − puertosOcupados` (R9.1).
- **Fibra**: `origenId ≠ destinoId` (R8.4).
- **Topología**: el grafo de `padreId` es un DAG (sin ciclos) — de hecho un bosque de árboles con raíz en POP (R7.4).
- **Sector**: `hogaresEstimados ≥ 0`; penetración indefinida si `= 0` (R12.4).

## Correctness Properties


*Una propiedad es una característica o comportamiento que debe cumplirse en todas las ejecuciones válidas del sistema — esencialmente, un enunciado formal sobre lo que el sistema debe hacer. Las propiedades son el puente entre la especificación legible por humanos y las garantías de corrección verificables por máquina.*

Estas propiedades aplican a la **lógica de dominio pura** del Gemelo Digital (validación, topología, capacidad, penetración, viabilidad, impacto, filtrado por vista/bbox). La persistencia PostGIS, el wiring de autenticación y el render visual se cubren con pruebas de integración, ejemplo y rendimiento (ver Testing Strategy), no con propiedades.

### Property 1: Validación de campos de enumeración

*Para todo* activo y *para todo* valor candidato de un campo de enumeración (`tipo` con dominio {POP, OLT, Switch, Router, NAP, Splitter, UPS, Servidor, Camara, Fibra, Empalme, ONU, Cliente} y `estado` con dominio {Activo, Inactivo, Mantenimiento, Retirado, Dañado}), la operación de guardado se acepta si y solo si el valor pertenece a su dominio; un valor fuera del dominio siempre se rechaza.

**Validates: Requirements 1.1, 1.4**

### Property 2: Régimen obligatorio para activos no propios

*Para todo* activo, guardar la propiedad se acepta si y solo si el activo es propio, o no es propio y su régimen pertenece a {Arrendado, Comodato, Tercero}.

**Validates: Requirements 1.5**

### Property 3: Obligatoriedad de tipo y coordenadas

*Para todo* activo al que le falte el `tipo` o las coordenadas GPS, la operación de guardado se rechaza y el mensaje de error indica el campo obligatorio faltante; si ambos están presentes (y el resto es válido), no se rechaza por este motivo.

**Validates: Requirements 1.7**

### Property 4: Round-trip de la ficha del activo

*Para todo* activo válido —incluyendo sus atributos específicos por tipo (R4.1–R4.8), indicadores de riesgo y el conjunto de fotografías y documentos adjuntos— al persistirlo y volver a consultarlo se obtiene una ficha equivalente: los atributos por tipo, el riesgo y las referencias de fotos y documentos coinciden exactamente con lo registrado.

**Validates: Requirements 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.2**

### Property 5: Cálculo del capital desplegado

*Para todo* conjunto de activos con datos económicos, el capital desplegado calculado es igual a la suma de (costo de compra + costo de instalación) de los activos seleccionados, y es invariante respecto al orden de los activos.

**Validates: Requirements 2.2**

### Property 6: Garantía vencida

*Para todo* activo con fecha de fin de garantía, el activo se marca con garantía vencida si y solo si su fecha de fin de garantía es anterior a la fecha actual.

**Validates: Requirements 2.3**

### Property 7: Instalación exige evidencia fotográfica

*Para todo* activo, marcarlo como instalado se acepta si y solo si tiene al menos una fotografía adjunta; con cero fotografías la operación siempre se rechaza con el mensaje de evidencia obligatoria.

**Validates: Requirements 3.2**

### Property 8: Cadena de dependencia ascendente

*Para toda* topología en árbol con raíz POP y *para todo* activo de la topología, la cadena ascendente devuelta comienza en el activo, termina en el POP raíz, y cada elemento es el padre del elemento anterior.

**Validates: Requirements 7.2**

### Property 9: Descendientes y clientes dependientes

*Para toda* topología en árbol y *para todo* activo, el conjunto de descendientes devuelto es exactamente el conjunto de nodos alcanzables hacia abajo desde el activo (excluyéndose a sí mismo), y la cantidad de clientes dependientes calculada automáticamente es exactamente el número de activos de tipo Cliente en ese subárbol (sin depender de ningún valor capturado manualmente).

**Validates: Requirements 7.3, 14.1, 14.4**

### Property 10: Rechazo de ciclos en la topología

*Para toda* topología en árbol y *para todo* par (activo, nuevoPadre), asignar `nuevoPadre` como padre del activo se rechaza si y solo si `nuevoPadre` es el propio activo o pertenece a su subárbol descendiente; en cualquier otro caso la relación se acepta.

**Validates: Requirements 7.4**

### Property 11: Round-trip del trazado de fibra

*Para todo* Segmento_Fibra registrado con un trazado geográfico, al solicitar la red de fibra se devuelve una geometría de línea (LineString) cuyo trazado es igual al registrado.

**Validates: Requirements 8.2**

### Property 12: Trayecto de fibra válido

*Para todo* Segmento_Fibra, su registro se rechaza si y solo si el activo de origen es igual al activo de destino.

**Validates: Requirements 8.4**

### Property 13: Cálculo de puertos libres

*Para toda* NAP con puertos totales y usados válidos, los puertos libres calculados son iguales a (puertos totales − puertos usados).

**Validates: Requirements 9.1**

### Property 14: Semáforo de capacidad

*Para toda* NAP con puertos totales mayores que cero, el estado del Semaforo_Capacidad es: verde si los puertos usados son menores al 75 % de los totales; amarillo si están entre el 75 % inclusive y el 100 % exclusive; y rojo si los puertos usados igualan los puertos totales.

**Validates: Requirements 9.2, 9.3, 9.4**

### Property 15: Rechazo de capacidad inválida

*Para toda* NAP, registrar los puertos usados se acepta si y solo si los puertos usados no superan los puertos totales; cualquier valor de usados mayor que el total se rechaza con un mensaje de capacidad inválida.

**Validates: Requirements 9.5**

### Property 16: Color de la vista Capacidad según semáforo

*Para toda* NAP, el color con que se representa en la Vista_Mapa Capacidad corresponde exactamente al estado de su Semaforo_Capacidad.

**Validates: Requirements 10.2**

### Property 17: Filtrado por vista del mapa

*Para todo* inventario de activos, la Vista_Mapa Incidencias devuelve exactamente los activos cuyo estado indica falla, y la Vista_Mapa Activos devuelve exactamente los activos instalados; ningún activo que no cumpla el predicado de la vista aparece, y ningún activo que lo cumpla queda excluido.

**Validates: Requirements 10.3, 10.4**

### Property 18: Vista Expansión por penetración baja

*Para todo* conjunto de sectores, la Vista_Mapa Expansión devuelve exactamente los sectores cuya penetración está por debajo del umbral de baja penetración.

**Validates: Requirements 10.5**

### Property 19: Conservación de cámara al cambiar de vista

*Para todo* estado de cámara (centro y nivel de zoom) y *para toda* Vista_Mapa de destino, cambiar de vista conserva el centro y el nivel de zoom previos sin modificarlos.

**Validates: Requirements 10.6**

### Property 20: Hogares conectados de un sector

*Para todo* sector y *para todo* conjunto de clientes asociados, la cantidad de hogares conectados calculada es exactamente el número de clientes en estado activo asociados al sector.

**Validates: Requirements 12.2**

### Property 21: Cálculo de penetración

*Para todo* sector: si los hogares estimados son cero, la penetración se reporta como no disponible; si son mayores que cero, la penetración es igual a (hogares conectados / hogares estimados) × 100, y queda en el rango [0, 100] cuando los conectados no superan a los estimados.

**Validates: Requirements 12.3, 12.4**

### Property 22: NAP más cercana por distancia de tendido

*Para todo* punto marcado y *para todo* conjunto no vacío de NAP, la NAP identificada en Modo_Construccion es aquella cuya Distancia_Tendido por rutas es mínima: ninguna otra NAP del conjunto tiene una Distancia_Tendido menor.

**Validates: Requirements 13.1**

### Property 23: Viabilidad de instalación con causa

*Para todo* resultado de Modo_Construccion definido por (puertos libres de la NAP, Distancia_Tendido, distancia máxima permitida), el resultado es Instalable si y solo si los puertos libres son al menos uno y la Distancia_Tendido es menor o igual a la distancia máxima; en otro caso es No instalable, con causa `sin_puertos` cuando no hay puertos libres y `fuera_de_alcance` cuando la Distancia_Tendido supera la distancia máxima.

**Validates: Requirements 13.3, 13.4**

### Property 24: Impacto de un Segmento_Fibra

*Para toda* red con un Segmento_Fibra, el Analisis_Impacto del segmento reporta la longitud registrada del segmento, una cantidad de clientes dependientes igual al número de clientes en el subárbol aguas abajo, una cantidad de NAP dependientes igual al número de NAP en ese subárbol, y unos ingresos mensuales consistentes con los planes de esos clientes.

**Validates: Requirements 14.2**

### Property 25: Ingresos mensuales asociados

*Para todo* conjunto de clientes dependientes con planes, los ingresos mensuales asociados calculados son iguales a la suma de los precios mensuales de los planes de dichos clientes, invariante respecto al orden.

**Validates: Requirements 14.3**

### Property 26: Filtrado de activos por área visible

*Para todo* inventario de activos y *para toda* área visible (bbox), los activos devueltos son exactamente los activos contenidos en el área visible: todos los devueltos están dentro del bbox y ningún activo dentro del bbox queda fuera del resultado.

**Validates: Requirements 17.1**

### Property 27: Agrupación por umbral de densidad

*Para todo* conjunto de activos contenidos en el área visible, la respuesta entrega representaciones agrupadas (clusters) si y solo si el conteo de activos visibles es mayor que 1000; con 1000 o menos se entregan activos individuales.

**Validates: Requirements 17.2**

## Error Handling

El manejo de errores reutiliza las excepciones HTTP de NestJS ya empleadas en `network.service.ts`/`network.controller.ts` y `auth/guards.ts`, devolviendo mensajes en español como hoy.

| Situación | Excepción | Respuesta |
|-----------|-----------|-----------|
| Activo sin `tipo` o sin coordenadas (R1.7) | `BadRequestException` | 400 con el nombre del campo faltante |
| Activo no propio sin régimen válido (R1.5) | `BadRequestException` | 400 indicando régimen requerido |
| Marcar instalado sin fotografía (R3.2) | `BadRequestException` | 400 "la evidencia fotográfica es obligatoria" |
| Relación que genera ciclo (R7.4) | `BadRequestException` | 400 "relación inválida" |
| Fibra con origen igual a destino (R8.4) | `BadRequestException` | 400 "trayecto inválido" |
| Puertos usados > totales (R9.5) | `BadRequestException` | 400 "capacidad inválida" |
| Activo/sitio/fibra/sector inexistente | `NotFoundException` | 404 |
| Petición sin JWT válido (R16.1) | `UnauthorizedException` (vía `JwtAuthGuard`) | 401 |
| Rol sin permiso para la operación (R16.2, R16.4) | `ForbiddenException` (vía `RolesGuard`) | 403 "No tienes permisos para esta acción" |
| Modo construcción sin NAP candidata | resultado `No instalable` con causa | 200 con `resultado: 'No instalable'` |
| Geocodificación no disponible (reuso) | `ServiceUnavailableException` | 503 |
| Sector con hogares estimados 0 (R12.4) | — (no es error) | 200 con `penetracion: null` |

Principios:
- **Validación en el borde** con DTOs + `class-validator` (como en los controllers actuales) antes de llegar al dominio.
- **Validación de invariantes en el dominio** (ciclos, capacidad, fibra) independiente del transporte, para que las propiedades se prueben sin HTTP.
- **Mensajes accionables** que nombran el campo o la causa, coherentes con el estilo actual de la API.

## Testing Strategy

Enfoque dual: **pruebas de propiedad** para la lógica de dominio universalmente cuantificable y **pruebas de ejemplo/integración/rendimiento** para CRUD, render, wiring de seguridad, PostGIS y desempeño.

### Property-Based Testing

Aplica a la lógica de dominio pura (validación, topología, capacidad, penetración, viabilidad de construcción, impacto, filtrado por vista/bbox y clustering). Estas funciones son deterministas, con entradas estructuradas amplias y propiedades universales (round-trips, invariantes, clasificación por umbrales, complementariedad), lo que las hace idóneas para PBT.

- **Librería**: `fast-check` con el runner de pruebas del proyecto (Jest o Vitest sobre el monorepo TypeScript). No se implementa PBT desde cero.
- **Iteraciones**: mínimo **100** por propiedad (`fc.assert(..., { numRuns: 100 })`).
- **Etiquetado**: cada prueba referencia su propiedad de diseño con un comentario.
  Formato: `// Feature: network-digital-twin, Property {número}: {texto de la propiedad}`
- **Una prueba de propiedad por cada propiedad de corrección** (Property 1–27).
- **Generadores**: 
  - Árboles de topología con raíz POP (para Properties 8, 9, 10, 24) generados recursivamente, con tipos de activo variados incluyendo Cliente y NAP.
  - NAPs con `(puertosTotal>0, 0≤usados≤total)` y casos frontera en 75 % y 100 % (Properties 13, 14, 16).
  - Fichas de activo por tipo con sus atributos, fotos y documentos (Property 4), cubriendo edge cases: hilos de fibra en el conjunto cerrado, cero fotos, caracteres especiales.
  - Puntos + conjuntos de NAP con distancias de tendido controladas (Properties 22, 23).
  - Inventarios + bbox aleatorios y conteos alrededor del umbral 1000 (Properties 26, 27).
  - Sectores con `hogaresEstimados` incluyendo 0 (Property 21).

### Pruebas de ejemplo (unitarias)

Para CRUD y casos concretos: almacenamiento de campos (R1.2, R1.3, R1.6, R1.8, R2.1, R3.1, R3.3, R5.1, R6.1, R6.2, R6.4, R7.1, R8.1, R8.3, R12.1, R13.2, R13.5), apertura de la ficha (R11.1) y secciones de render de la ficha (R11.2–R11.6, R10.1).

### Pruebas de integración

- **PostGIS (R15.1–R15.5)**: contra una base PostGIS real (contenedor de pruebas). Verifican persistencia, SRID 4326 de puntos/líneas/polígonos y `ST_Contains` para contención punto-en-polígono, con 1–3 ejemplos representativos. Opcionalmente *model-based*: contrastar `ST_Contains` contra `booleanPointInPolygon` de Turf en unos pocos casos para validar equivalencia con la implementación in-memory.
- **RBAC (R16.1–R16.5)**: pruebas e2e por rol (admin, operador, tecnico, anónimo) sobre endpoints de lectura, mutación, evidencia y borrado, verificando 200/401/403 según la matriz.

### Pruebas de rendimiento (smoke/benchmark)

- **R17.3**: sembrar un inventario de 10 000 activos y medir que `GET /infra/map/:vista?bbox=` responde en ≤ 2 s para un área visible. Ejecución única en CI (no property-based).

### Resumen de cobertura por requisito

| Requisito | Cobertura |
|-----------|-----------|
| R1.1, R1.4 | Property 1 |
| R1.5 | Property 2 |
| R1.7 | Property 3 |
| R1.2, R1.3, R1.6, R1.8 | Ejemplo |
| R2.2 | Property 5 |
| R2.3 | Property 6 |
| R2.1 | Ejemplo |
| R3.2 | Property 7 |
| R3.4, R5.2, R4.1–R4.8 | Property 4 |
| R3.1, R3.3, R5.1 | Ejemplo |
| R6.3 | Property 9 (round-trip de pertenencia vía consulta de activos del sitio) / Ejemplo 6.1–6.4 |
| R7.2 | Property 8 |
| R7.3, R14.1, R14.4 | Property 9 |
| R7.4 | Property 10 |
| R7.1 | Ejemplo |
| R8.2 | Property 11 |
| R8.4 | Property 12 |
| R8.1, R8.3 | Ejemplo |
| R9.1 | Property 13 |
| R9.2, R9.3, R9.4 | Property 14 |
| R9.5 | Property 15 |
| R10.2 | Property 16 |
| R10.3, R10.4 | Property 17 |
| R10.5 | Property 18 |
| R10.6 | Property 19 |
| R10.1, R11.1–R11.6 | Ejemplo |
| R12.2 | Property 20 |
| R12.3, R12.4 | Property 21 |
| R12.1 | Ejemplo |
| R13.1 | Property 22 |
| R13.3, R13.4 | Property 23 |
| R13.2, R13.5 | Ejemplo |
| R14.2 | Property 24 |
| R14.3 | Property 25 |
| R15.1–R15.5 | Integración |
| R16.1–R16.5 | Integración / Ejemplo e2e |
| R17.1 | Property 26 |
| R17.2 | Property 27 |
| R17.3 | Rendimiento (smoke) |
