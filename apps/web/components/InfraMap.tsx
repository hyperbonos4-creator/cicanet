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
import { API_URL } from "../lib/api";

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
  onMapClick?: (lng: number, lat: number) => void;
  drawing?: boolean;
  drawPoints?: [number, number][];
  draggablePin?: { lng: number; lat: number } | null;
  pinColor?: string;
  onPinMove?: (lng: number, lat: number) => void;
};

/** FeatureCollection para el dibujo en vivo de una zona (vértices + línea + polígono). */
function drawFC(points: [number, number][]): FC {
  const feats: any[] = points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
  if (points.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
  if (points.length >= 3) feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...points, points[0]]] }, properties: {} });
  return { type: "FeatureCollection", features: feats };
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

export default function InfraMap({ assets, fiber, barrios, zones, onSelect, selectedId, focusPoint, onMapClick, drawing, drawPoints, draggablePin, pinColor, onPinMove }: Props) {
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

  const [basemap, setBasemap] = useState<Basemap>("blueprint");
  const [show, setShow] = useState({ enlaces: true, fibra: true, clientes: true, etiquetas: true });

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

      // Imagen satelital de respaldo (Esri, sin token — fiable) + ortofoto Medellin.
      map.addSource("sat", {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar",
      });
      map.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" }, paint: { "raster-opacity": 1, "raster-saturation": -0.1 } });
      map.addSource("ortofoto", {
        type: "raster", tiles: [`${API_URL}/tiles/medellin/{z}/{y}/{x}`], tileSize: 256, minzoom: 0, maxzoom: 22,
        attribution: "Ortofoto 2024 © Alcaldía de Medellín (CC)",
      });
      map.addLayer({ id: "ortofoto", type: "raster", source: "ortofoto", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } });

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

      // 2) Fibra real (con glow).
      map.addSource("infra-fiber", { type: "geojson", data: fiber as any });
      map.addLayer({ id: "infra-fiber-glow", type: "line", source: "infra-fiber", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#6366F1", "line-width": 7, "line-opacity": 0.18, "line-blur": 4 } });
      map.addLayer({ id: "infra-fiber-line", type: "line", source: "infra-fiber", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#818CF8", "line-width": 2.2, "line-opacity": 0.95 } });

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

      // Clic en zona vacía -> enrutado (modo Vender / dibujo de zona).
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["infra-assets-dot"] });
        if (hits.length) return; // fue clic en un activo
        onMapClickRef.current?.(e.lngLat.lng, e.lngLat.lat);
      });

      rebuildLabels(map, assets, labelsRef, show.etiquetas);
      fitToNetwork(map, assets);
      applyVisibility(map, show, labelsRef.current);
    });

    return () => {
      labelsRef.current.forEach((m) => m.remove());
      labelsRef.current = [];
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
    setV("carto", basemap === "blueprint");
    setV("sat", basemap === "satelite");
    setV("ortofoto", basemap === "ortofoto");
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
