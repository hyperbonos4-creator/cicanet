"use client";

// ============================================================
//  InfraMap — Mapa PROFESIONAL del Gemelo Digital de la Red.
//  A diferencia de CoverageMap (Red & Mapa, orientado a cobertura/ventas),
//  este vista de ingenieria dibuja TODA la infraestructura REAL trazada:
//   - Enlaces de topologia (cada activo -> su padre): POP→OLT→NAP→Cliente
//   - Tramos de fibra con su trazado real (LineString)
//   - Activos tipados (POP/OLT/NAP/Splitter/Empalme/Camara/ONU/Cliente...)
//     con color por tipo, etiqueta y semaforo de capacidad en las NAP
//  Encuadra automaticamente a TODA la red (Medellin + Bello + ...).
// ============================================================

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Popup, Marker } from "maplibre-gl";
import { API_URL } from "../../lib/api";

type FC = { type: "FeatureCollection"; features: any[] };

type Basemap = "blueprint" | "satelite" | "ortofoto";

type Props = {
  assets: FC;
  fiber: FC;
  barrios?: FC | null;
  zones?: FC | null;
  onSelect?: (props: Record<string, any>) => void;
  selectedId?: string | null;
  focusPoint?: { lng: number; lat: number; color?: string } | null;
  // Interacciones (modo Vender / dibujo de zonas en la pestaña Cobertura).
  onMapClick?: (lng: number, lat: number, snappedId?: string | null) => void;
  drawing?: boolean;
  drawPoints?: [number, number][];
  // Trazado de fibra poste a poste (polilínea ABIERTA — nunca se cierra en polígono).
  routing?: boolean;
  routePoints?: [number, number][];
  // Modo "colocar activo": clic en el mapa = ubicar un poste/NAP donde quieras.
  placing?: boolean;
  // Atajos de teclado del editor (estilo iD): P/N/E/S/C, Esc, Backspace.
  onShortcut?: (action: "poste" | "nap" | "empalme" | "splitter" | "cable" | "cancel" | "undo") => void;
  draggablePin?: { lng: number; lat: number } | null;
  pinColor?: string;
  onPinMove?: (lng: number, lat: number) => void;
  // Modo "Conectar postes": clic en poste tras poste crea tramos de fibra (A→B, B→C…).
  chaining?: boolean;
  // Edición de fibra: clic en un tramo => arrastrar sus vértices y anclarlos a postes.
  canEdit?: boolean;
  onSaveFiber?: (
    id: string,
    trazado: [number, number][],
    ends: { origenId?: string | null; destinoId?: string | null },
  ) => Promise<void> | void;
  /** Elimina por completo un tramo de fibra (desde la barra de edición). */
  onDeleteFiber?: (id: string) => Promise<void> | void;
};

/** FeatureCollection para el dibujo en vivo de una zona (vértices + línea + polígono). */
function drawFC(points: [number, number][]): FC {
  const feats: any[] = points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
  if (points.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
  if (points.length >= 3) feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...points, points[0]]] }, properties: {} });
  return { type: "FeatureCollection", features: feats };
}

/** FeatureCollection del trazado de fibra: vértices (postes) + polilínea ABIERTA. Nunca polígono. */
function routeFC(points: [number, number][]): FC {
  const feats: any[] = points.map((p, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: p },
    properties: { idx: i, head: i === points.length - 1 },
  }));
  if (points.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
  return { type: "FeatureCollection", features: feats };
}

/** Busca el activo más cercano al punto de pantalla dentro de un umbral en píxeles (snapping). */
function findSnap(map: MlMap, assets: FC, pt: { x: number; y: number }, maxPx = 16):
  { lng: number; lat: number; id: string; tipo: string } | null {
  let best: { lng: number; lat: number; id: string; tipo: string } | null = null;
  let bestD = maxPx;
  for (const f of assets.features) {
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const p = map.project(c as [number, number]);
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d <= bestD) { bestD = d; best = { lng: c[0], lat: c[1], id: f.properties.id, tipo: f.properties.tipo }; }
  }
  return best;
}

/** Longitud aproximada (m) de una polilínea [[lng,lat],…] por haversine. */
function lineLengthM(pts: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const [lng1, lat1] = pts[i - 1];
    const [lng2, lat2] = pts[i];
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    m += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return Math.round(m);
}

/** Estilo visual por tipo de activo (color + radio del punto + etiqueta legible). */
const TIPO: Record<string, { color: string; r: number; label: string }> = {
  POP: { color: "#22D3EE", r: 9, label: "POP / Central" },
  OLT: { color: "#3B82F6", r: 7.5, label: "OLT" },
  Switch: { color: "#6366F1", r: 6, label: "Switch" },
  Router: { color: "#8B5CF6", r: 6, label: "Router" },
  NAP: { color: "#22E0A1", r: 6.5, label: "NAP / Caja" },
  CTO: { color: "#22E0A1", r: 6.5, label: "CTO" },
  Splitter: { color: "#38BDF8", r: 5.5, label: "Splitter" },
  Empalme: { color: "#A3E635", r: 5, label: "Empalme" },
  Poste: { color: "#D6A35C", r: 4.5, label: "Poste" },
  Camara: { color: "#F472B6", r: 5, label: "Cámara" },
  UPS: { color: "#FBBF24", r: 5, label: "UPS" },
  Servidor: { color: "#FBBF24", r: 5, label: "Servidor" },
  ONU: { color: "#94A3B8", r: 4, label: "ONU" },
  Cliente: { color: "#38BDF8", r: 3.6, label: "Cliente" },
  Fibra: { color: "#6366F1", r: 4, label: "Fibra" },
};
const SEMAFORO: Record<string, string> = { verde: "#22E0A1", amarillo: "#FFB02E", rojo: "#FF4D6D" };
const tipoColor = (t: string) => (TIPO[t]?.color ?? "#8B96AC");

/** Expresion MapLibre 'match' para colorear/dimensionar por tipo. */
function matchByType(prop: "color" | "r", fallback: any): any {
  const expr: any[] = ["match", ["get", "tipo"]];
  for (const [t, v] of Object.entries(TIPO)) expr.push(t, (v as any)[prop]);
  expr.push(fallback);
  return expr;
}

/** Construye los enlaces de topologia (linea de cada activo a su padre). */
function buildLinks(assets: FC): FC {
  const pos = new Map<string, [number, number]>();
  for (const f of assets.features) pos.set(f.properties.id, f.geometry.coordinates);
  const feats: any[] = [];
  for (const f of assets.features) {
    const p = f.properties;
    const parent = p.padreId && pos.get(p.padreId);
    if (parent) {
      feats.push({
        type: "Feature",
        properties: { id: p.id, tipo: p.tipo },
        geometry: { type: "LineString", coordinates: [f.geometry.coordinates, parent] },
      });
    }
  }
  return { type: "FeatureCollection", features: feats };
}

const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

const BLUEPRINT: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "&copy; CARTO &copy; OpenStreetMap",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#060B16" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.55, "raster-saturation": -0.7, "raster-brightness-max": 0.7 } },
  ],
};

export default function InfraMap({ assets, fiber, barrios, zones, onSelect, selectedId, focusPoint, onMapClick, drawing, drawPoints, routing, routePoints, placing, onShortcut, draggablePin, pinColor, onPinMove, canEdit, onSaveFiber, onDeleteFiber, chaining }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const labelsRef = useRef<Marker[]>([]);
  const focusRef = useRef<Marker | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const loadedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onMapClickRef = useRef(onMapClick);
  const onPinMoveRef = useRef(onPinMove);
  onSelectRef.current = onSelect;
  onMapClickRef.current = onMapClick;
  onPinMoveRef.current = onPinMove;
  // Refs espejo para los handlers registrados una sola vez en el init.
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const fiberRef = useRef(fiber);
  fiberRef.current = fiber;
  const modeRef = useRef({ drawing, routing, placing, chaining });
  modeRef.current = { drawing: !!drawing, routing: !!routing, placing: !!placing, chaining: !!chaining };
  const snapRef = useRef<{ lng: number; lat: number; id: string } | null>(null);
  const onShortcutRef = useRef(onShortcut);
  onShortcutRef.current = onShortcut;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onSaveFiberRef = useRef(onSaveFiber);
  onSaveFiberRef.current = onSaveFiber;
  const onDeleteFiberRef = useRef(onDeleteFiber);
  onDeleteFiberRef.current = onDeleteFiber;

  // ---- estado de edición de un tramo de fibra (arrastrar vértices) ----
  const editRef = useRef<{ id: string; points: [number, number][]; snapIds: (string | null | undefined)[]; sel: number | null; extendDir: "off" | "start" | "end" } | null>(null);
  const vtxMarkersRef = useRef<Marker[]>([]);
  const lastDragRef = useRef(0);
  const startEditRef = useRef<(id: string) => void>(() => {});
  const appendVertexRef = useRef<(lng: number, lat: number, snapId: string | null) => void>(() => {});
  const [editFiber, setEditFiber] = useState<{ id: string; count: number; longitudM: number; sel: number | null; extendDir: "off" | "start" | "end" } | null>(null);

  const [basemap, setBasemap] = useState<Basemap>("blueprint");
  const [show, setShow] = useState({ enlaces: true, fibra: true, clientes: true, etiquetas: true });

  // Redibuja la previsualización (línea + vértices) del tramo en edición.
  function redrawEdit() {
    const map = mapRef.current;
    const src = map?.getSource("infra-fiber-edit") as any;
    if (!src) return;
    const ed = editRef.current;
    if (!ed) { src.setData(emptyFC()); return; }
    const feats: any[] = ed.points.map((p, i) => ({
      type: "Feature", properties: { idx: i }, geometry: { type: "Point", coordinates: p },
    }));
    if (ed.points.length >= 2) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ed.points } });
    src.setData({ type: "FeatureCollection", features: feats });
  }

  // Sincroniza la barra (toolbar) con el estado interno de edición.
  function syncToolbar() {
    const ed = editRef.current;
    setEditFiber((f) => (f && ed ? { ...f, count: ed.points.length, longitudM: lineLengthM(ed.points), sel: ed.sel, extendDir: ed.extendDir } : f));
  }

  // Añade un vértice al INICIO o al FINAL del trazado (modo "Extender"): continúa
  // el recorrido por el extremo elegido. Si el clic cae cerca de un poste, el
  // vértice se pega a él.
  function appendVertex(lng: number, lat: number, snapId: string | null) {
    const ed = editRef.current;
    if (!ed || ed.extendDir === "off") return;
    if (ed.extendDir === "start") {
      ed.points.unshift([lng, lat]);
      ed.snapIds.unshift(snapId ?? null);
      ed.sel = 0;
    } else {
      ed.points.push([lng, lat]);
      ed.snapIds.push(snapId ?? null);
      ed.sel = ed.points.length - 1;
    }
    buildVtxMarkers();
    redrawEdit();
    syncToolbar();
  }
  appendVertexRef.current = appendVertex;

  // Construye un marcador arrastrable por cada vértice. Al soltar, si hay un
  // poste/activo cerca, el vértice se ancla EXACTO a su coordenada. Entre cada
  // par de vértices hay un handle "+" para INSERTAR un vértice intermedio (así
  // la fibra puede doblarse por los postes exactos sin desviarse). Un clic
  // simple sobre el vértice lo SELECCIONA (para poder eliminarlo desde la barra).
  function buildVtxMarkers() {
    const map = mapRef.current; const ed = editRef.current;
    if (!map || !ed) return;
    vtxMarkersRef.current.forEach((m) => m.remove());
    vtxMarkersRef.current = [];

    // Handles intermedios "+": se dibujan PRIMERO para que queden debajo de los
    // vértices reales (los vértices tienen prioridad de clic).
    for (let i = 0; i < ed.points.length - 1; i++) {
      const a = ed.points[i];
      const b = ed.points[i + 1];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const el = document.createElement("div");
      el.style.cssText = "width:16px;height:16px;border-radius:50%;background:rgba(34,211,238,0.3);border:1.5px dashed #22D3EE;cursor:copy;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;line-height:1;font-weight:700;";
      el.textContent = "+";
      el.title = "Insertar un vértice aquí";
      const mk = new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ed.points.splice(i + 1, 0, mid);
        ed.snapIds.splice(i + 1, 0, undefined);
        ed.sel = i + 1; // selecciona el nuevo vértice para moverlo enseguida
        buildVtxMarkers();
        redrawEdit();
        syncToolbar();
      });
      vtxMarkersRef.current.push(mk);
    }

    // Vértices reales (arrastrables; clic = seleccionar).
    ed.points.forEach((p, i) => {
      const selected = ed.sel === i;
      const el = document.createElement("div");
      const size = selected ? 20 : 16;
      const bg = selected ? "#FFB02E" : "#22D3EE";
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 0 10px ${bg};cursor:grab;`;
      el.title = "Arrastra para mover · clic para seleccionar y eliminar";
      const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
      const apply = () => {
        const ll = mk.getLngLat();
        const snap = findSnap(map, assetsRef.current, map.project([ll.lng, ll.lat]), 24);
        const snapSrc = map.getSource("infra-snap") as any;
        let coord: [number, number];
        if (snap) {
          coord = [snap.lng, snap.lat];
          mk.setLngLat(coord);
          ed.snapIds[i] = snap.id;
          snapSrc?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coord } }] });
        } else {
          coord = [ll.lng, ll.lat];
          ed.snapIds[i] = null;
          snapSrc?.setData(emptyFC());
        }
        ed.points[i] = coord;
        redrawEdit();
      };
      mk.on("drag", apply);
      mk.on("dragend", () => {
        apply();
        lastDragRef.current = Date.now();
        (map.getSource("infra-snap") as any)?.setData(emptyFC());
        syncToolbar();
      });
      // Clic simple (no arrastre) selecciona el vértice.
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (Date.now() - lastDragRef.current < 250) return; // fue el final de un arrastre
        ed.sel = ed.sel === i ? null : i;
        buildVtxMarkers();
        syncToolbar();
      });
      vtxMarkersRef.current.push(mk);
    });
  }

  // Elimina el vértice seleccionado (deja al menos 2).
  function deleteSelectedVtx() {
    const ed = editRef.current;
    if (!ed || ed.sel == null || ed.points.length <= 2) return;
    ed.points.splice(ed.sel, 1);
    ed.snapIds.splice(ed.sel, 1);
    ed.sel = null;
    buildVtxMarkers();
    redrawEdit();
    syncToolbar();
  }

  function startEditFiber(id: string) {
    const feat = (fiberRef.current.features as any[]).find((f) => f.properties?.id === id);
    const coords = feat?.geometry?.coordinates as number[][] | undefined;
    if (!coords || coords.length < 2) return;
    editRef.current = {
      id,
      points: coords.map((c) => [c[0], c[1]] as [number, number]),
      snapIds: coords.map(() => undefined),
      sel: null,
      extendDir: "off",
    };
    // Mientras se edita, el doble clic NO debe hacer zoom (estorba al editar).
    mapRef.current?.doubleClickZoom.disable();
    buildVtxMarkers();
    redrawEdit();
    setEditFiber({ id, count: coords.length, longitudM: lineLengthM(editRef.current.points), sel: null, extendDir: "off" });
  }
  startEditRef.current = startEditFiber;

  function clearEditFiber() {
    vtxMarkersRef.current.forEach((m) => m.remove());
    vtxMarkersRef.current = [];
    editRef.current = null;
    const map = mapRef.current;
    map?.doubleClickZoom.enable();
    (map?.getSource("infra-fiber-edit") as any)?.setData(emptyFC());
    (map?.getSource("infra-snap") as any)?.setData(emptyFC());
    setEditFiber(null);
  }

  async function saveEditFiber() {
    const ed = editRef.current;
    if (!ed) return;
    const origenId = ed.snapIds[0];
    const destinoId = ed.snapIds[ed.snapIds.length - 1];
    await onSaveFiberRef.current?.(ed.id, ed.points.map((p) => [p[0], p[1]] as [number, number]), { origenId, destinoId });
    clearEditFiber();
  }

  // Elimina por completo el tramo en edición (tras confirmar) y vuelve a trazarlo.
  async function deleteWholeFiber() {
    const ed = editRef.current;
    if (!ed) return;
    if (!window.confirm(`¿Eliminar por completo el tramo ${ed.id}? Esta acción no se puede deshacer.`)) return;
    await onDeleteFiberRef.current?.(ed.id);
    clearEditFiber();
  }

  // ---- init (una vez) ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BLUEPRINT,
      center: [-75.55, 6.30],
      zoom: 12,
      attributionControl: false,
      pitch: 0,
      antialias: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      loadedRef.current = true;

      // ===== Imágenes satelitales (cubren TODO; nunca se ponen negras) =====
      // Capa base global de respaldo: Esri World Imagery (sin token, fiable).
      map.addSource("sat-esri", {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar",
      });
      map.addLayer({ id: "sat-esri", type: "raster", source: "sat-esri", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } });
      // Satélite de Google (Map Tiles API) — imagen MÁS ACTUALIZADA, cubre Medellín y Bello,
      // permite acercar a nivel de poste (z22). Va ENCIMA de Esri (que rellena cualquier hueco).
      map.addSource("sat-gsat", {
        type: "raster",
        tiles: [`${API_URL}/tiles/gsat/{z}/{x}/{y}`],
        tileSize: 256, minzoom: 0, maxzoom: 22, attribution: "Imagery © Google",
      });
      map.addLayer({ id: "sat-gsat", type: "raster", source: "sat-gsat", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } });
      // Ortofoto oficial de Medellín 2024 (CC) — máximo detalle SOLO en Medellín.
      // Va encima del satélite; donde no existe (Bello), se ve Google/Esri debajo.
      map.addSource("ortofoto", {
        type: "raster", tiles: [`${API_URL}/tiles/medellin/{z}/{y}/{x}`], tileSize: 256, minzoom: 0, maxzoom: 22,
        attribution: "Ortofoto 2024 © Alcaldía de Medellín (CC)",
      });
      map.addLayer({ id: "ortofoto", type: "raster", source: "ortofoto", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } });
      // Ortofoto oficial del Valle de Aburrá (AMVA · SIM) por bbox, reproyectada a
      // Web Mercator y cacheada por el backend. Cubre TODO el metro incl. Bello/
      // Zamora/Santa Rita — la base nítida y SIN clave para Bello.
      map.addSource("ortofoto-amva", {
        type: "raster", tiles: [`${API_URL}/tiles/ortofoto-amva?bbox={bbox-epsg-3857}`], tileSize: 512, minzoom: 12, maxzoom: 19,
        attribution: "Ortofoto © AMVA · Área Metropolitana del Valle de Aburrá",
      });
      map.addLayer({ id: "ortofoto-amva", type: "raster", source: "ortofoto-amva", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } }, "ortofoto");

      // Contexto: barrios (sutil) y zonas de cobertura dibujadas.
      map.addSource("infra-barrios", { type: "geojson", data: (barrios as any) || emptyFC() });
      map.addLayer({ id: "infra-barrios-line", type: "line", source: "infra-barrios", paint: { "line-color": "#3B82F6", "line-width": 0.8, "line-opacity": 0.25 } });
      map.addSource("infra-zones", { type: "geojson", data: (zones as any) || emptyFC() });
      map.addLayer({ id: "infra-zones-fill", type: "fill", source: "infra-zones", paint: { "fill-color": "#22E0A1", "fill-opacity": 0.05 } });
      map.addLayer({ id: "infra-zones-line", type: "line", source: "infra-zones", paint: { "line-color": "#22E0A1", "line-width": 1, "line-opacity": 0.4, "line-dasharray": [3, 2] } });

      // 1) Enlaces de topologia (activo -> padre): el "esqueleto" trazado de la red.
      map.addSource("infra-links", { type: "geojson", data: buildLinks(assets) as any });
      map.addLayer({
        id: "infra-links", type: "line", source: "infra-links",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#2DD4BF", "line-width": 1.1, "line-opacity": 0.5, "line-dasharray": [2, 1.5] },
      });

      // 2) Fibra real (con glow). Más visible: línea más gruesa que escala con el zoom.
      map.addSource("infra-fiber", { type: "geojson", data: fiber as any });
      map.addLayer({ id: "infra-fiber-glow", type: "line", source: "infra-fiber", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#60A5FA", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 16, 11, 20, 18], "line-opacity": 0.3, "line-blur": 4 } });
      map.addLayer({ id: "infra-fiber-line", type: "line", source: "infra-fiber", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#3B82F6", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.4, 16, 4, 20, 6], "line-opacity": 1 } });
      // Línea de toque INVISIBLE y ancha: facilita seleccionar el tramo con el clic.
      map.addLayer({ id: "infra-fiber-hit", type: "line", source: "infra-fiber", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000000", "line-width": 16, "line-opacity": 0.01 } });

      // 3) Activos: glow + punto tipado + anillo de capacidad (NAP) + badge cámara.
      map.addSource("infra-assets", { type: "geojson", data: assets as any });
      map.addLayer({
        id: "infra-assets-glow", type: "circle", source: "infra-assets",
        paint: { "circle-radius": matchByType("r", 5), "circle-color": matchByType("color", "#8B96AC"), "circle-blur": 1, "circle-opacity": 0.4 },
      });
      // Anillo de capacidad para NAP (color por semaforo).
      map.addLayer({
        id: "infra-assets-cap", type: "circle", source: "infra-assets",
        filter: ["==", ["get", "tipo"], "NAP"],
        paint: {
          "circle-radius": 10,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2,
          "circle-stroke-color": ["match", ["coalesce", ["get", "semaforo"], "verde"], "rojo", SEMAFORO.rojo, "amarillo", SEMAFORO.amarillo, SEMAFORO.verde],
          "circle-stroke-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "infra-assets-dot", type: "circle", source: "infra-assets",
        paint: {
          "circle-radius": matchByType("r", 5),
          "circle-color": matchByType("color", "#8B96AC"),
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#060B16",
        },
      });
      // Resaltado del activo seleccionado.
      map.addLayer({
        id: "infra-assets-sel", type: "circle", source: "infra-assets",
        filter: ["==", ["get", "id"], selectedId ?? "__none__"],
        paint: { "circle-radius": 14, "circle-color": "rgba(255,255,255,0)", "circle-stroke-width": 2.5, "circle-stroke-color": "#FFFFFF", "circle-stroke-opacity": 0.9 },
      });

      // Interacciones: clic en un activo -> popup + onSelect.
      map.on("click", "infra-assets-dot", (e) => {
        // En modo edición (trazar/colocar/dibujar), el clic lo gestiona el handler
        // general con snapping; no seleccionamos ni abrimos popup.
        if (modeRef.current.routing || modeRef.current.placing || modeRef.current.drawing) return;
        const f = e.features?.[0]; if (!f) return;
        const p: any = f.properties;
        onSelectRef.current?.(p);
        const cap = p.puertosTotal != null ? `<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#8B96AC">Puertos</span><strong style="color:#fff">${p.puertosUsados ?? 0}/${p.puertosTotal}</strong></div>` : "";
        const cli = (p.clientesDependientes ?? 0) > 0 ? `<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:#8B96AC">Clientes</span><strong style="color:#22E0A1">${p.clientesDependientes}</strong></div>` : "";
        new Popup({ offset: 14, closeButton: false })
          .setLngLat((f.geometry as any).coordinates)
          .setHTML(`<div style="font-size:12px;min-width:150px"><strong style="color:#fff;font-size:13px">${p.nombre ?? p.id}</strong><div style="color:#8B96AC;margin:2px 0 6px">${TIPO[p.tipo]?.label ?? p.tipo} · ${p.id}</div>${cap}${cli}</div>`)
          .addTo(map);
      });
      map.on("mouseenter", "infra-assets-dot", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "infra-assets-dot", () => (map.getCanvas().style.cursor = ""));

      // Capa de dibujo en vivo (pestaña Cobertura).
      map.addSource("infra-draw", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "infra-draw-fill", type: "fill", source: "infra-draw", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#22D3EE", "fill-opacity": 0.15 } });
      map.addLayer({ id: "infra-draw-line", type: "line", source: "infra-draw", paint: { "line-color": "#22D3EE", "line-width": 2, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "infra-draw-vtx", type: "circle", source: "infra-draw", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#22D3EE", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });

      // Capa del TRAZADO de fibra poste a poste (polilínea abierta + postes numerados).
      map.addSource("infra-route", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "infra-route-glow", type: "line", source: "infra-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFB02E", "line-width": 8, "line-opacity": 0.25, "line-blur": 3 } });
      map.addLayer({ id: "infra-route-line", type: "line", source: "infra-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFB02E", "line-width": 2.6 } });
      map.addLayer({ id: "infra-route-vtx", type: "circle", source: "infra-route", filter: ["==", "$type", "Point"], paint: { "circle-radius": ["case", ["==", ["get", "head"], true], 7, 5], "circle-color": "#FFB02E", "circle-stroke-width": 2, "circle-stroke-color": "#060B16" } });

      // Indicador de SNAPPING: anillo sobre el activo al que el clic se va a "pegar".
      map.addSource("infra-snap", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "infra-snap", type: "circle", source: "infra-snap",
        paint: { "circle-radius": 11, "circle-color": "rgba(255,176,46,0.12)", "circle-stroke-width": 2.5, "circle-stroke-color": "#FFB02E", "circle-stroke-opacity": 0.95 },
      });

      // Edición de fibra: previsualización (línea punteada + vértices) del tramo
      // que se está reeditando arrastrando sus vértices.
      map.addSource("infra-fiber-edit", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "infra-fiber-edit-line", type: "line", source: "infra-fiber-edit", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#22D3EE", "line-width": 3, "line-dasharray": [1.5, 1], "line-opacity": 0.95 } });
      map.addLayer({ id: "infra-fiber-edit-vtx", type: "circle", source: "infra-fiber-edit", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#22D3EE", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });

      // Cursor de mano sobre un tramo de fibra (solo si se puede editar y no se
      // está trazando/colocando/dibujando), para invitar a seleccionarlo.
      map.on("mouseenter", "infra-fiber-hit", () => {
        const m = modeRef.current;
        if (canEditRef.current && !m.routing && !m.placing && !m.drawing && !editRef.current) {
          map.getCanvas().style.cursor = "pointer";
        }
      });
      map.on("mouseleave", "infra-fiber-hit", () => {
        const m = modeRef.current;
        if (!m.routing && !m.placing && !m.drawing) map.getCanvas().style.cursor = "";
      });

      // Clic en zona vacía -> enrutado (modo Vender / dibujo de zona / trazado / colocar).
      // En modo trazar/colocar aplica SNAPPING: si hay un activo cercano, el punto
      // se "pega" a su coordenada exacta y se reporta su id (para conectar la fibra).
      map.on("click", (e) => {
        const m = modeRef.current;
        if (m.routing || m.placing || m.chaining) {
          const snap = findSnap(map, assetsRef.current, e.point, m.chaining ? 24 : 16);
          if (snap) onMapClickRef.current?.(snap.lng, snap.lat, snap.id);
          else onMapClickRef.current?.(e.lngLat.lng, e.lngLat.lat, null);
          return;
        }
        // Editando un tramo: en modo "Extender", el clic AÑADE un vértice en el
        // extremo elegido (continúa el recorrido); si cae cerca de un poste, se
        // pega a él.
        if (editRef.current) {
          if (editRef.current.extendDir !== "off") {
            const snap = findSnap(map, assetsRef.current, e.point, 24);
            if (snap) appendVertexRef.current(snap.lng, snap.lat, snap.id);
            else appendVertexRef.current(e.lngLat.lng, e.lngLat.lat, null);
          }
          return; // sin extender, el arrastre lo manejan los marcadores
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: ["infra-assets-dot"] });
        if (hits.length) return; // fue clic en un activo
        onMapClickRef.current?.(e.lngLat.lng, e.lngLat.lat, null);
      });

      // Mientras se traza/coloca/extiende, resalta el activo al que el clic haría snap.
      map.on("mousemove", (e) => {
        const m = modeRef.current;
        const src = map.getSource("infra-snap") as any;
        if (!src) return;
        const extending = !!editRef.current && editRef.current.extendDir !== "off";
        if (!m.routing && !m.placing && !m.chaining && !extending) {
          if (snapRef.current) { snapRef.current = null; src.setData(emptyFC()); }
          return;
        }
        const snap = findSnap(map, assetsRef.current, e.point, extending || m.chaining ? 24 : 16);
        snapRef.current = snap;
        src.setData(snap
          ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [snap.lng, snap.lat] } }] }
          : emptyFC());
      });

      rebuildLabels(map, assets, labelsRef, show.etiquetas);
      fitToNetwork(map, assets);
      applyVisibility(map, show, labelsRef.current);
    });

    return () => {
      labelsRef.current.forEach((m) => m.remove());
      labelsRef.current = [];
      vtxMarkersRef.current.forEach((m) => m.remove());
      vtxMarkersRef.current = [];
      editRef.current = null;
      focusRef.current?.remove(); focusRef.current = null;
      pinRef.current?.remove(); pinRef.current = null;
      map.remove(); mapRef.current = null; loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- refrescar fuentes cuando cambian los datos ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("infra-assets") as any)?.setData(assets);
    (map.getSource("infra-links") as any)?.setData(buildLinks(assets));
    (map.getSource("infra-fiber") as any)?.setData(fiber);
    rebuildLabels(map, assets, labelsRef, show.etiquetas);
    applyVisibility(map, show, labelsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, fiber]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("infra-barrios") as any)?.setData((barrios as any) || emptyFC());
    (map.getSource("infra-zones") as any)?.setData((zones as any) || emptyFC());
  }, [barrios, zones]);

  // ---- activo seleccionado (resaltado) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (map.getLayer("infra-assets-sel")) map.setFilter("infra-assets-sel", ["==", ["get", "id"], selectedId ?? "__none__"]);
  }, [selectedId]);

  // ---- toggles de capas ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyVisibility(map, show, labelsRef.current);
  }, [show]);

  // ---- basemap ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const setV = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
    // Esquema (CARTO oscuro) para vista de ingeniería.
    setV("carto", basemap === "blueprint");
    // Satélite: Google (cubre TODO el Valle de Aburrá incl. Bello/Zamora a z22),
    // con Esri World Imagery debajo como respaldo si Google no está disponible.
    setV("sat-esri", basemap !== "blueprint");
    setV("sat-gsat", basemap !== "blueprint");
    // Ortofoto oficial de Medellín ENCIMA del satélite: máximo detalle donde existe;
    // donde no (Bello), debajo queda la ortofoto AMVA (todo el metro) y el satélite.
    setV("ortofoto", basemap === "ortofoto");
    setV("ortofoto-amva", basemap === "ortofoto");
  }, [basemap]);

  // ---- punto enfocado (desde el panel "Ver en el mapa") ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    focusRef.current?.remove(); focusRef.current = null;
    if (!focusPoint) return;
    const color = focusPoint.color || "#22D3EE";
    const el = document.createElement("div");
    el.style.cssText = `width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 0 18px ${color};`;
    focusRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([focusPoint.lng, focusPoint.lat]).addTo(map);
    map.flyTo({ center: [focusPoint.lng, focusPoint.lat], zoom: Math.max(map.getZoom(), 16), speed: 0.8 });
  }, [focusPoint]);

  // ---- dibujo en vivo de zona (pestaña Cobertura) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("infra-draw") as any)?.setData(drawing && drawPoints ? drawFC(drawPoints) : emptyFC());
  }, [drawing, drawPoints]);

  // ---- trazado de fibra poste a poste (polilínea abierta) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("infra-route") as any)?.setData(routing && routePoints ? routeFC(routePoints) : emptyFC());
  }, [routing, routePoints]);

  // ---- cursor de precisión cuando se está trazando o colocando un activo ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.getCanvas().style.cursor = drawing || routing || placing || chaining ? "crosshair" : "";
  }, [drawing, routing, placing, chaining]);

  // ---- atajos de teclado del editor (estilo iD): P/N/E/S/C, Esc, Backspace ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === "escape") { onShortcutRef.current?.("cancel"); return; }
      if (k === "backspace") { ev.preventDefault(); onShortcutRef.current?.("undo"); return; }
      const keymap: Record<string, "poste" | "nap" | "empalme" | "splitter" | "cable"> =
        { p: "poste", n: "nap", e: "empalme", s: "splitter", c: "cable" };
      if (keymap[k]) onShortcutRef.current?.(keymap[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- limpiar el indicador de snap al salir del modo edición ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (!routing && !placing && !chaining) {
      snapRef.current = null;
      (map.getSource("infra-snap") as any)?.setData(emptyFC());
    }
  }, [routing, placing, chaining]);

  // ---- cancelar la edición de fibra si se entra a trazar/colocar/dibujar ----
  useEffect(() => {
    if (routing || placing || drawing) {
      if (editRef.current) clearEditFiber();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routing, placing, drawing]);

  // ---- pin arrastrable (modo Vender / consulta) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (!draggablePin) { pinRef.current?.remove(); pinRef.current = null; return; }
    const color = pinColor || "#22D3EE";
    const { lng, lat } = draggablePin;
    if (!pinRef.current) {
      const el = document.createElement("div");
      el.style.cssText = `width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 0 20px ${color};cursor:grab;`;
      const m = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true });
      m.on("dragend", () => { const ll = m.getLngLat(); onPinMoveRef.current?.(ll.lng, ll.lat); });
      m.setLngLat([lng, lat]).addTo(map);
      pinRef.current = m;
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), speed: 0.8 });
    } else {
      pinRef.current.setLngLat([lng, lat]);
      const el = pinRef.current.getElement();
      el.style.background = color; el.style.boxShadow = `0 0 20px ${color}`;
    }
  }, [draggablePin, pinColor]);

  const totals = countByType(assets);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Barra de edición de fibra: aparece al seleccionar un tramo en el mapa. */}
      {editFiber && (
        <div className="pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-wrap items-center gap-2.5 rounded-xl border border-cica-glow/40 bg-black/85 px-4 py-2 shadow-2xl backdrop-blur">
          <div className="text-[11px] leading-tight">
            <div className="font-bold text-white">Editando fibra · {editFiber.id}</div>
            <div className="text-cica-muted">
              {editFiber.extendDir !== "off"
                ? `EXTENDER por el ${editFiber.extendDir === "start" ? "INICIO" : "FINAL"}: clic en cada poste para continuar (se pega solo)`
                : editFiber.sel != null
                ? `Vértice ${editFiber.sel + 1}/${editFiber.count} seleccionado`
                : "Clic en un vértice para seleccionarlo · arrastra para moverlo · «+» inserta"} · {editFiber.longitudM} m
            </div>
          </div>
          <button
            onClick={() => { const ed = editRef.current; if (ed) { ed.extendDir = ed.extendDir === "start" ? "off" : "start"; ed.sel = null; buildVtxMarkers(); syncToolbar(); } }}
            title="Continuar el recorrido por el INICIO del tramo"
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${editFiber.extendDir === "start" ? "bg-cica-glow text-black" : "border border-cica-glow/50 text-cica-glow hover:bg-cica-glow/15"}`}
          >
            ◀ Inicio
          </button>
          <button
            onClick={() => { const ed = editRef.current; if (ed) { ed.extendDir = ed.extendDir === "end" ? "off" : "end"; ed.sel = null; buildVtxMarkers(); syncToolbar(); } }}
            title="Continuar el recorrido por el FINAL del tramo"
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${editFiber.extendDir === "end" ? "bg-cica-glow text-black" : "border border-cica-glow/50 text-cica-glow hover:bg-cica-glow/15"}`}
          >
            Final ▶
          </button>
          <button
            onClick={deleteSelectedVtx}
            disabled={editFiber.sel == null || editFiber.count <= 2}
            title={editFiber.count <= 2 ? "Un tramo necesita al menos 2 vértices" : "Eliminar el vértice seleccionado"}
            className="rounded-lg border border-status-sin/50 bg-status-sin/15 px-3 py-1.5 text-[11px] font-semibold text-status-sin hover:bg-status-sin/25 disabled:opacity-40"
          >
            Eliminar vértice
          </button>
          <button onClick={deleteWholeFiber} title="Eliminar el tramo completo" className="rounded-lg border border-status-sin/50 px-3 py-1.5 text-[11px] font-semibold text-status-sin hover:bg-status-sin/20">🗑 Tramo</button>
          <button onClick={saveEditFiber} className="rounded-lg bg-cica-gold px-3 py-1.5 text-[11px] font-bold text-black hover:opacity-90">Guardar</button>
          <button onClick={clearEditFiber} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-cica-silver hover:bg-white/10">Cancelar</button>
        </div>
      )}

      {/* Selector de base + capas (estilo ingenieria) */}
      <div className="pointer-events-auto absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-white/10 bg-black/55 text-[11px] font-semibold shadow-lg backdrop-blur">
          {([["blueprint", "◈ Esquema"], ["satelite", "🛰️ Satélite"], ["ortofoto", "🏙️ Ortofoto"]] as [Basemap, string][]).map(([id, lbl]) => (
            <button key={id} onClick={() => setBasemap(id)} className={`px-3 py-1.5 transition-colors ${basemap === id ? "bg-cica-gold text-black" : "text-cica-silver hover:bg-white/10"}`}>{lbl}</button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-white/10 bg-black/55 text-[11px] font-semibold shadow-lg backdrop-blur">
          {([["enlaces", "Enlaces"], ["fibra", "Fibra"], ["clientes", "Clientes"], ["etiquetas", "Etiquetas"]] as [keyof typeof show, string][]).map(([k, lbl]) => (
            <button key={k} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className={`border-l border-white/10 px-2.5 py-1.5 transition-colors first:border-l-0 ${show[k] ? "bg-cica-glow/25 text-white" : "text-cica-muted hover:bg-white/10"}`}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Resumen de la red (arriba a la derecha) */}
      <div className="glass-soft pointer-events-none absolute right-3 top-3 z-10 px-3 py-2 text-[11px]">
        <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-cica-muted">Infraestructura trazada</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-cica-silver">
          {totals.map((t) => (
            <span key={t.tipo} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: tipoColor(t.tipo), boxShadow: `0 0 6px ${tipoColor(t.tipo)}` }} />
              {t.tipo} <strong className="text-white">{t.n}</strong>
            </span>
          ))}
          {totals.length === 0 && <span className="text-cica-muted">Sin activos aún.</span>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Helpers
// ============================================================

function applyVisibility(map: MlMap, show: { enlaces: boolean; fibra: boolean; clientes: boolean; etiquetas: boolean }, labels: Marker[]) {
  const set = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
  set("infra-links", show.enlaces);
  set("infra-fiber-glow", show.fibra);
  set("infra-fiber-line", show.fibra);
  // Clientes: filtro en las capas de activos (oculta solo los dots de tipo Cliente).
  const notClient: any = ["!=", ["get", "tipo"], "Cliente"];
  const all: any = ["!=", ["get", "id"], "__never__"];
  for (const id of ["infra-assets-glow", "infra-assets-dot"]) {
    if (map.getLayer(id)) map.setFilter(id, show.clientes ? all : notClient);
  }
  labels.forEach((m) => { m.getElement().style.display = show.etiquetas ? "" : "none"; });
}

/** Etiquetas tipo "pill" para los nodos de infraestructura (no para clientes). */
function rebuildLabels(map: MlMap, assets: FC, ref: React.MutableRefObject<Marker[]>, visible: boolean) {
  ref.current.forEach((m) => m.remove());
  ref.current = [];
  for (const f of assets.features) {
    const p = f.properties;
    if (p.tipo === "Cliente" || p.tipo === "ONU") continue; // no saturar con clientes
    const el = document.createElement("div");
    el.textContent = p.nombre ?? p.id;
    const color = tipoColor(p.tipo);
    el.style.cssText = `transform:translateY(-14px);font-size:9.5px;font-weight:700;color:#E9EDF5;white-space:nowrap;pointer-events:none;` +
      `padding:1px 5px;border-radius:5px;background:rgba(6,11,22,0.7);border:1px solid ${color}55;box-shadow:0 0 8px rgba(0,0,0,0.6);letter-spacing:0.2px;`;
    if (!visible) el.style.display = "none";
    const m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(f.geometry.coordinates).addTo(map);
    ref.current.push(m);
  }
}

/** Encuadra el mapa a TODA la red (Medellin + Bello + ...). */
function fitToNetwork(map: MlMap, assets: FC) {
  const fs = assets.features;
  if (!fs.length) return;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const f of fs) {
    const [x, y] = f.geometry.coordinates;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (minX === maxX && minY === maxY) { map.flyTo({ center: [minX, minY], zoom: 15 }); return; }
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 90, duration: 0, maxZoom: 17 });
}

/** Conteo de activos por tipo (para el resumen). */
function countByType(assets: FC): { tipo: string; n: number }[] {
  const m = new Map<string, number>();
  for (const f of assets.features) m.set(f.properties.tipo, (m.get(f.properties.tipo) ?? 0) + 1);
  const order = Object.keys(TIPO);
  return [...m.entries()]
    .sort((a, b) => (order.indexOf(a[0]) - order.indexOf(b[0])))
    .map(([tipo, n]) => ({ tipo, n }));
}
