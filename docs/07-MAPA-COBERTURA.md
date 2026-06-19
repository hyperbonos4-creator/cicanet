# 07 · Mapa de cobertura en tiempo real

El mapa es la pieza más visible de CICANET y **lo primero que se va a revisar**. Muestra dónde hay cobertura, la infraestructura de red y el estado en vivo, sobre el mapa real de Medellín (empezando por **Popular 2**, Comuna 1 - Nororiente).

## Tecnología

| Pieza | Rol |
|-------|-----|
| **MapLibre GL JS** | Render del mapa (vectorial, WebGL) en la web |
| **PostGIS** | Almacena y consulta geometrías (cobertura, nodos, fibra) |
| **Martin** | Sirve las geometrías de PostGIS como tiles vectoriales (MVT) |
| **Socket.IO** | Empuja cambios de estado en vivo (NAP offline, nuevo cliente) |
| **GeoMedellín / MEData** | Datos base oficiales: comunas, barrios, manzanas, vías |

## Capas del mapa

```
Capa 6 → Cobertura      🟩 FTTH  🟨 parcial  🟥 sin cobertura
Capa 5 → Clientes       puntos por estado (activo/suspendido)
Capa 4 → NAPs / CTOs    marcadores con capacidad de puertos
Capa 3 → Red troncal    líneas de fibra (LineString)
Capa 2 → Barrios        polígonos oficiales (GeoMedellín)
Capa 1 → Comunas        polígonos oficiales
Base   → Mapa           tiles base (OSM/MapLibre)
```

Cada capa se puede encender/apagar desde el panel.

## Estado en tiempo real

- Los nodos (`nodos_red.estado`) cambian de color según online/offline/degradado.
- Cuando el monitoreo detecta un nodo caído, la API emite un evento WebSocket y el marcador cambia **sin recargar**.
- Los clientes nuevos aparecen en el mapa al instalarse.

## Funciones clave

### Consulta de cobertura por dirección
El vendedor escribe una dirección → se geocodifica → consulta espacial:
```sql
SELECT a.tecnologia, a.estado, n.nombre AS nodo_cercano
FROM areas_cobertura a
LEFT JOIN LATERAL (
  SELECT nombre FROM nodos_red
  ORDER BY ubicacion <-> ST_SetSRID(ST_Point(:lng,:lat),4326)
  LIMIT 1
) n ON true
WHERE ST_Contains(a.poligono, ST_SetSRID(ST_Point(:lng,:lat),4326))
LIMIT 1;
```
Respuesta:
```json
{ "cobertura": true, "tecnologia": "FTTH", "estado": "cobertura", "nodo": "NAP-023" }
```

### Cobertura calculada (heatmap automático)
En vez de dibujar polígonos a mano, se puede **calcular** la cobertura como el radio efectivo de cada NAP (`ST_Buffer`), pintando automáticamente la zona servida.

### Impacto de un corte
Seleccionar un segmento de fibra muestra **todos los clientes aguas abajo** que quedarían sin servicio (consulta recursiva sobre la jerarquía de nodos — ver [04-MODELO-DATOS.md](04-MODELO-DATOS.md)).

## Flujo de datos del mapa

```
PostGIS (geometrías)
   │
   ├──► Martin ──► tiles vectoriales ──► MapLibre (capas estáticas)
   │
   └──► API NestJS ──► Socket.IO ──► MapLibre (estado en vivo)
```

## Datos para Popular 2 (Fase 1) — ✅ con geometría OFICIAL

Los límites son **reales**, descargados de GeoMedellín (no dibujados a mano):

- **Fuente:** GeoMedellín · capa *"Barrios y Veredas de Medellín"* (límite catastral, WGS84),
  servida vía FeatureServer de ArcGIS. Se filtró la **Comuna 1** (`limitecomu='01'`) →
  12 barrios, incluido **Popular** (`codigo='0103'`, polígono de 1.034 vértices).
- **Descarga:** `infra/geodata_comuna1.geojson` (GeoJSON crudo oficial).
- **Procesamiento:** `apps/api/scripts/build-geodata.mjs` lee ese GeoJSON, recorta el
  barrio Popular y **genera nodos, clientes y áreas de cobertura DENTRO del polígono real**
  (validado con point-in-polygon), produciendo `apps/api/src/network/popular2.geo.json`.
- **En el mapa:** los 12 barrios se dibujan como contexto (con etiquetas), Popular se
  resalta y enmarca, y la consulta de cobertura distingue *dentro del barrio* vs *fuera*.

> Reproducir la descarga (ejemplo):
> ```
> FeatureServer .../Barrios_y_Veredas_de_Medellin/FeatureServer/0/query
>   ?where=limitecomu='01'&outFields=nombre,codigo&outSR=4326&f=geojson
> ```

**Siguiente paso (producción):** cargar este mismo GeoJSON en la tabla PostGIS
`areas_cobertura`/`nodos_red` y servir vía Martin, conmutando la API de JSON a SQL.

> Esta es la primera entrega visible de la plataforma (ver [ROADMAP.md](ROADMAP.md), Fase 1).
