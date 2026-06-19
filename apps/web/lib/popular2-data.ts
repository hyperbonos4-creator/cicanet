/**
 * Datos geográficos de demostración — Barrio Popular (Comuna 1, Medellín).
 *
 * ⚠️ DEMO: estas geometrías son representativas para la muestra. En producción
 * se reemplazan por:
 *   - Límites oficiales de barrio/comuna desde GeoMedellín / MEData.
 *   - Áreas de cobertura reales levantadas en campo.
 *   - Coordenadas reales de NAPs/CTOs y clientes georreferenciados.
 *   - Sirviendo todo desde PostGIS vía Martin (tiles vectoriales).
 *
 * Centro aproximado: Estación Metrocable "Popular" (Línea K), Comuna 1 Nororiente.
 */

export type FeatureCollection = {
  type: "FeatureCollection";
  features: any[];
};

export const POPULAR2_CENTER: [number, number] = [-75.5487, 6.2967];
export const POPULAR2_ZOOM = 15.2;

/** Límite aproximado del sector cubierto (para resaltar la zona de operación). */
export const sectorBoundary: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { nombre: "Sector Popular 2 — Comuna 1" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.5518, 6.2992],
            [-75.5446, 6.2992],
            [-75.5440, 6.2938],
            [-75.5512, 6.2936],
            [-75.5518, 6.2992],
          ],
        ],
      },
    },
  ],
};

/** Áreas de cobertura clasificadas por estado/tecnología. */
export const coverageAreas: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "COV-FTTH-01",
        nombre: "Popular 2 · Núcleo FTTH",
        estado: "ftth",
        tecnologia: "FTTH",
        clientes: 184,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.5512, 6.2985],
            [-75.5478, 6.2986],
            [-75.5476, 6.2958],
            [-75.5510, 6.2957],
            [-75.5512, 6.2985],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "COV-PAR-01",
        nombre: "Popular 2 · Cobertura parcial",
        estado: "parcial",
        tecnologia: "FTTH (en expansión)",
        clientes: 63,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.5478, 6.2986],
            [-75.5450, 6.2987],
            [-75.5449, 6.2960],
            [-75.5476, 6.2958],
            [-75.5478, 6.2986],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        id: "COV-SIN-01",
        nombre: "Popular 2 · Sin cobertura (planeado Q3)",
        estado: "sin",
        tecnologia: "No disponible",
        clientes: 0,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-75.5510, 6.2957],
            [-75.5476, 6.2958],
            [-75.5474, 6.2940],
            [-75.5508, 6.2939],
            [-75.5510, 6.2957],
          ],
        ],
      },
    },
  ],
};

/** Nodos de red: POP principal, NAPs y CTOs con su capacidad de puertos. */
export const networkNodes: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "POP-01",
        nombre: "POP-01 · Nodo principal",
        tipo: "POP",
        estado: "online",
        puertos_total: 256,
        puertos_usados: 247,
      },
      geometry: { type: "Point", coordinates: [-75.5491, 6.2973] },
    },
    {
      type: "Feature",
      properties: {
        id: "NAP-01",
        nombre: "NAP-01",
        tipo: "NAP",
        estado: "online",
        puertos_total: 16,
        puertos_usados: 11,
      },
      geometry: { type: "Point", coordinates: [-75.5501, 6.2978] },
    },
    {
      type: "Feature",
      properties: {
        id: "NAP-02",
        nombre: "NAP-02",
        tipo: "NAP",
        estado: "online",
        puertos_total: 16,
        puertos_usados: 8,
      },
      geometry: { type: "Point", coordinates: [-75.5484, 6.2966] },
    },
    {
      type: "Feature",
      properties: {
        id: "NAP-03",
        nombre: "NAP-03",
        tipo: "NAP",
        estado: "online",
        puertos_total: 16,
        puertos_usados: 15,
      },
      geometry: { type: "Point", coordinates: [-75.5468, 6.2974] },
    },
    {
      type: "Feature",
      properties: {
        id: "NAP-04",
        nombre: "NAP-04",
        tipo: "NAP",
        estado: "degradado",
        puertos_total: 16,
        puertos_usados: 16,
      },
      geometry: { type: "Point", coordinates: [-75.5460, 6.2964] },
    },
    {
      type: "Feature",
      properties: {
        id: "CTO-05",
        nombre: "CTO-05",
        tipo: "CTO",
        estado: "online",
        puertos_total: 8,
        puertos_usados: 5,
      },
      geometry: { type: "Point", coordinates: [-75.5497, 6.2962] },
    },
  ],
};

/** Tramos de fibra troncal (POP → NAPs). */
export const fiberLines: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "FIB-01" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-75.5491, 6.2973],
          [-75.5501, 6.2978],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "FIB-02" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-75.5491, 6.2973],
          [-75.5484, 6.2966],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "FIB-03" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-75.5491, 6.2973],
          [-75.548, 6.297],
          [-75.5468, 6.2974],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "FIB-04" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-75.5468, 6.2974],
          [-75.546, 6.2964],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "FIB-05" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-75.5491, 6.2973],
          [-75.5497, 6.2962],
        ],
      },
    },
  ],
};

/** Clientes georreferenciados (muestra). */
export const clients: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    ["CL-1001", -75.5505, 6.2981, "activo"],
    ["CL-1002", -75.5498, 6.2975, "activo"],
    ["CL-1003", -75.5495, 6.2969, "activo"],
    ["CL-1004", -75.5489, 6.2979, "suspendido"],
    ["CL-1005", -75.5486, 6.2971, "activo"],
    ["CL-1006", -75.5482, 6.2963, "activo"],
    ["CL-1007", -75.5479, 6.2982, "activo"],
    ["CL-1008", -75.5472, 6.2969, "suspendido"],
    ["CL-1009", -75.5465, 6.2977, "activo"],
    ["CL-1010", -75.5463, 6.2961, "activo"],
    ["CL-1011", -75.5503, 6.2965, "activo"],
    ["CL-1012", -75.5494, 6.2983, "activo"],
  ].map(([id, lng, lat, estado]) => ({
    type: "Feature",
    properties: { id, estado },
    geometry: { type: "Point", coordinates: [lng, lat] },
  })),
};

/** Métricas agregadas del sector (para las tarjetas del panel). */
export const sectorStats = {
  clientesActivos: 247,
  clientesTotales: 263,
  naps: 5,
  coberturaFTTH: 78, // % del sector con FTTH
  uptime: 99.4,
};
