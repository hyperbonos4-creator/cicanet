/**
 * Procesa el GeoJSON OFICIAL de GeoMedellín y genera el dataset que sirve la API.
 *
 * Zona de servicio CICANET = barrios reales de Comuna 1 (Popular) + Comuna 2
 * (Santa Cruz) + Comuna 4 (Aranjuez). La red demo (POP/NAP/clientes) se ancla
 * en el barrio Popular; el resto de la zona queda como expansión.
 *
 *   node apps/api/scripts/build-geodata.mjs
 *
 * Entrada : infra/geodata_zona.geojson  (descargado de GeoMedellín, comunas 01/02/04)
 * Salida  : apps/api/src/network/popular2.geo.json
 *
 * Fuente: GeoMedellín · "Barrios y Veredas de Medellín" (límite catastral, WGS84).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
// Usa la zona ampliada si existe; si no, cae al archivo de Comuna 1.
const IN_ZONA = resolve(ROOT, "infra/geodata_zona.geojson");
const IN_C1 = resolve(ROOT, "infra/geodata_comuna1.geojson");
const IN = existsSync(IN_ZONA) ? IN_ZONA : IN_C1;
const OUT = resolve(__dirname, "../src/network/popular2.geo.json");

const POPULAR_CODE = "0103"; // ancla de la red construida (demo)

// ---------- helpers geométricos ----------
function bbox(coords) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const walk = (a) => {
    if (typeof a[0] === "number") {
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
      minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
    } else a.forEach(walk);
  };
  walk(coords);
  return [minX, minY, maxX, maxY];
}

// Ray-casting sobre un anillo [ [lng,lat], ... ]
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Punto dentro de una geometría Polygon o MultiPolygon (anillo exterior).
function pointInGeom(lng, lat, geom) {
  if (!geom) return false;
  if (geom.type === "Polygon") return pointInRing(lng, lat, geom.coordinates[0]);
  if (geom.type === "MultiPolygon")
    return geom.coordinates.some((poly) => pointInRing(lng, lat, poly[0]));
  return false;
}

// Círculo geodésico aproximado (radio en metros) → anillo [lng,lat]
function circle(lng, lat, radiusM, steps = 48) {
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return [ring];
}

// PRNG determinista (LCG) → reproducible entre builds
let _seed = 1337;
const rand = () => {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};

// ---------- carga ----------
const raw = JSON.parse(readFileSync(IN, "utf8"));
const COMUNA_LABEL = { "01": "Comuna 1 · Popular", "02": "Comuna 2 · Santa Cruz", "04": "Comuna 4 · Aranjuez" };

const barrios = raw.features.map((f) => {
  const codigo = String(f.properties.codigo ?? f.properties.CODIGO ?? "");
  const comuna = String(f.properties.limitecomu ?? codigo.slice(0, 2));
  return {
    type: "Feature",
    properties: {
      nombre: f.properties.nombre ?? f.properties.NOMBRE,
      codigo,
      comuna,
      comunaNombre: COMUNA_LABEL[comuna] || `Comuna ${comuna}`,
    },
    geometry: f.geometry,
  };
});

const popular = barrios.find((f) => f.properties.codigo === POPULAR_CODE) || barrios[0];
const popGeom = popular.geometry;
const [pMinX, pMinY, pMaxX, pMaxY] = bbox(popGeom.coordinates);
const center = [(pMinX + pMaxX) / 2, (pMinY + pMaxY) / 2];

// bbox de TODA la zona de servicio (para enmarcar el mapa)
const [zMinX, zMinY, zMaxX, zMaxY] = bbox(barrios.map((b) => b.geometry.coordinates));

// Muestrea un punto dentro del barrio Popular real (rechazo por bbox)
function sampleInside(margin = 0.85) {
  const cx = center[0], cy = center[1];
  for (let t = 0; t < 5000; t++) {
    const lng = cx + (rand() - 0.5) * (pMaxX - pMinX) * margin;
    const lat = cy + (rand() - 0.5) * (pMaxY - pMinY) * margin;
    if (pointInGeom(lng, lat, popGeom)) return [lng, lat];
  }
  return center;
}

function farFrom(pts, p, minDeg) {
  return pts.every(([x, y]) => Math.hypot(x - p[0], y - p[1]) > minDeg);
}

// ---------- nodos de red (anclados en Popular) ----------
const nodesMeta = [
  { id: "POP-01", nombre: "POP-01 · Nodo principal", tipo: "POP", total: 256, used: 247 },
  { id: "NAP-01", nombre: "NAP-01", tipo: "NAP", total: 16, used: 11 },
  { id: "NAP-02", nombre: "NAP-02", tipo: "NAP", total: 16, used: 8 },
  { id: "NAP-03", nombre: "NAP-03", tipo: "NAP", total: 16, used: 15 },
  { id: "NAP-04", nombre: "NAP-04", tipo: "NAP", total: 16, used: 16 },
  { id: "NAP-05", nombre: "NAP-05", tipo: "NAP", total: 16, used: 6 },
  { id: "NAP-06", nombre: "NAP-06 · planeado", tipo: "NAP", total: 16, used: 0 },
  { id: "CTO-07", nombre: "CTO-07", tipo: "CTO", total: 8, used: 5 },
  { id: "CTO-08", nombre: "CTO-08", tipo: "CTO", total: 8, used: 3 },
];

const placed = [];
const nodeFeatures = nodesMeta.map((m, i) => {
  let p;
  if (i === 0) {
    p = center; // POP cerca del centro de Popular
  } else {
    let tries = 0;
    do { p = sampleInside(0.8); tries++; } while (!farFrom(placed, p, 0.0016) && tries < 200);
  }
  placed.push(p);
  const estado = m.tipo !== "POP" && m.used >= m.total ? "degradado" : "online";
  return {
    type: "Feature",
    properties: {
      id: m.id, nombre: m.nombre, tipo: m.tipo, estado,
      puertos_total: m.total, puertos_usados: m.used,
    },
    geometry: { type: "Point", coordinates: [round(p[0]), round(p[1])] },
  };
});

// ---------- cobertura: círculo por NAP/CTO ----------
const accessNodes = nodeFeatures.filter((f) => f.properties.tipo !== "POP");
const coverageFeatures = accessNodes.map((f) => {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const ratio = p.puertos_usados / p.puertos_total;
  let estado = "ftth";
  if (p.puertos_usados === 0) estado = "sin";
  else if (ratio >= 0.9) estado = "parcial";
  const radio = p.tipo === "CTO" ? 130 : 190;
  return {
    type: "Feature",
    properties: {
      id: `COV-${p.id}`,
      nombre: `Cobertura ${p.id}`,
      estado,
      tecnologia: estado === "sin" ? "FTTH (planeado)" : "FTTH",
      clientes: Math.round(p.puertos_usados * 1.4),
    },
    geometry: { type: "Polygon", coordinates: circle(lng, lat, radio) },
  };
});

// ---------- fibra troncal: POP → cada nodo de acceso ----------
const pop = nodeFeatures[0].geometry.coordinates;
const fiberFeatures = accessNodes.map((f, i) => ({
  type: "Feature",
  properties: { id: `FIB-${String(i + 1).padStart(2, "0")}` },
  geometry: { type: "LineString", coordinates: [pop, f.geometry.coordinates] },
}));

// ---------- clientes dentro del barrio Popular real ----------
const N_CLIENTES = 46;
const clientFeatures = [];
for (let i = 0; i < N_CLIENTES; i++) {
  const p = sampleInside(0.92);
  const estado = rand() < 0.12 ? "suspendido" : "activo";
  clientFeatures.push({
    type: "Feature",
    properties: { id: `CL-${1001 + i}`, estado },
    geometry: { type: "Point", coordinates: [round(p[0]), round(p[1])] },
  });
}

// ---------- métricas ----------
const activos = clientFeatures.filter((c) => c.properties.estado === "activo").length;
const stats = {
  clientesActivos: activos,
  clientesTotales: clientFeatures.length,
  naps: accessNodes.length,
  coberturaFTTH: 82,
  uptime: 99.4,
};

function round(n) { return Math.round(n * 1e6) / 1e6; }
const fc = (features) => ({ type: "FeatureCollection", features });

const out = {
  meta: {
    center: [round(center[0]), round(center[1])],
    zoom: 13.2,
    bbox: [round(zMinX), round(zMinY), round(zMaxX), round(zMaxY)],
    fuente: "GeoMedellín · Barrios y Veredas (Comunas 1·2·4, WGS84)",
  },
  // Capa de contexto: todos los barrios de la zona de servicio.
  comuna1: fc(barrios),
  // Zona de servicio = unión de los barrios servidos (Comuna 1+2+4).
  sector: fc(barrios.map((b) => ({
    type: "Feature",
    properties: { nombre: b.properties.nombre, codigo: b.properties.codigo, comuna: b.properties.comuna },
    geometry: b.geometry,
  }))),
  coverage: fc(coverageFeatures),
  fiber: fc(fiberFeatures),
  nodes: fc(nodeFeatures),
  clients: fc(clientFeatures),
  stats,
};

writeFileSync(OUT, JSON.stringify(out));
console.log("✓ Generado:", OUT);
console.log("  barrios (zona):", barrios.length, "| nodos:", nodeFeatures.length, "| clientes:", clientFeatures.length, "| coverage:", coverageFeatures.length);
console.log("  centro Popular:", out.meta.center.join(", "), "| bbox zona:", out.meta.bbox.map((n) => n.toFixed(4)).join(", "));
