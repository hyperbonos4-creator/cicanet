"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Popup, Marker } from "maplibre-gl";
import { API_URL } from "../lib/api";

type FC = { type: "FeatureCollection"; features: any[] };

// Ortofoto oficial de Medellín 2024 (GeoMedellín, CC) servida y CACHEADA por
// nuestro backend (/api/tiles/medellin) — independiente del servidor municipal.
const ORTOFOTO_TILES = `${API_URL}/tiles/medellin/{z}/{y}/{x}`;

type Basemap = "dark" | "satelite" | "esri" | "ortofoto";

export type MapData = {
  meta: { center: [number, number]; zoom: number; bbox?: [number, number, number, number] };
  comuna1: FC;
  sector: FC;
  coverage: FC;
  fiber: FC;
  clients: FC;
  nodes: FC;
  zones?: FC;
};

type LayerVisibility = {
  barrios: boolean;
  cobertura: boolean;
  fibra: boolean;
  nodos: boolean;
  clientes: boolean;
};

type CheckResult = {
  cobertura: boolean;
  estado: string;
  lng: number;
  lat: number;
} | null;

type Props = {
  data: MapData;
  visibility: LayerVisibility;
  onNodeSelect?: (props: Record<string, any> | null) => void;
  onMapClick?: (lng: number, lat: number) => void;
  checkResult?: CheckResult;
  focusPoint?: { lng: number; lat: number; color?: string } | null;
  drawing?: boolean;
  drawPoints?: [number, number][];
  draggablePin?: { lng: number; lat: number } | null;
  pinColor?: string;
  onPinMove?: (lng: number, lat: number) => void;
  infra?: { assets: FC; fiber: FC } | null;
  showOnlyInfra?: boolean;
};

const DARK_STYLE: maplibregl.StyleSpecification = {
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
      attribution:
        '&copy; <a href="https://carto.com/">CARTO</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#04060C" } },
    {
      id: "carto",
      type: "raster",
      source: "carto",
      paint: { "raster-opacity": 0.9, "raster-saturation": -0.2 },
    },
  ],
};

const COVERAGE_COLORS: Record<string, string> = {
  ftth: "#22E0A1",
  parcial: "#FFB02E",
  sin: "#FF4D6D",
};

function napClass(used: number, total: number, estado: string): string {
  if (estado === "degradado") return "nap-marker nap-near";
  const ratio = total > 0 ? used / total : 1;
  if (ratio >= 1) return "nap-marker nap-full";
  if (ratio >= 0.85) return "nap-marker nap-near";
  return "nap-marker nap-available";
}

export default function CoverageMap({
  data,
  visibility,
  onNodeSelect,
  onMapClick,
  checkResult,
  focusPoint,
  drawing,
  drawPoints,
  draggablePin,
  pinColor,
  onPinMove,
  infra,
  showOnlyInfra,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [catastro, setCatastro] = useState(false);
  const markersRef = useRef<Marker[]>([]);
  const labelsRef = useRef<Marker[]>([]);
  const checkMarkerRef = useRef<Marker | null>(null);
  const focusMarkerRef = useRef<Marker | null>(null);
  const pinMarkerRef = useRef<Marker | null>(null);
  const lastFlyRef = useRef<[number, number] | null>(null);
  const loadedRef = useRef(false);
  // refs estables para callbacks usados dentro del init
  const onMapClickRef = useRef(onMapClick);
  const onNodeSelectRef = useRef(onNodeSelect);
  const onPinMoveRef = useRef(onPinMove);
  onMapClickRef.current = onMapClick;
  onNodeSelectRef.current = onNodeSelect;
  onPinMoveRef.current = onPinMove;

  // Init del mapa (una vez)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: data.meta.center,
      zoom: data.meta.zoom,
      attributionControl: false,
      pitch: 35,
      bearing: -12,
      antialias: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      loadedRef.current = true;

      // === Base satelital en DOS capas (resiliencia + nitidez) ===========
      // 1) Base Esri World Imagery (gratis, sin token): garantiza que SIEMPRE
      //    haya imagen aunque el proxy/Mapbox falle. Va debajo.
      map.addSource("sat-base", {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      });
      map.addLayer({
        id: "sat-base",
        type: "raster",
        source: "sat-base",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 1 },
      });
      // 2) Mapbox Satellite @2x (512 px, hasta z22) vía proxy del backend (token
      //    en el servidor). Va ENCIMA de Esri; si una tesela no llega (204), se
      //    ve la de Esri debajo. Mucho más nítida y permite acercar mucho más.
      map.addSource("sat-hd", {
        type: "raster",
        tiles: [`${API_URL}/tiles/satellite/{z}/{x}/{y}`],
        tileSize: 512,
        minzoom: 0,
        maxzoom: 22,
        attribution: "Imagery © Mapbox, Maxar",
      });
      map.addLayer({
        id: "sat-hd",
        type: "raster",
        source: "sat-hd",
        layout: { visibility: "none" },
        // Realce sutil para que la ladera (Bello/Zamora/Santa Rita) no se vea apagada.
        paint: { "raster-opacity": 1, "raster-contrast": 0.12, "raster-saturation": 0.12, "raster-brightness-min": 0.04 },
      });
      // 3) Ortofoto oficial Medellín 2024 (CC) vía proxy cacheado del backend.
      //    Va encima de Esri; si una tesela no llega, se ve Esri debajo.
      map.addSource("ortofoto", {
        type: "raster",
        tiles: [ORTOFOTO_TILES],
        tileSize: 256,
        minzoom: 0,
        // Caché oficial con teselas nativas hasta z22 (nitidez a nivel de calle).
        maxzoom: 22,
        attribution: "Ortofoto 2024 © Alcaldía de Medellín · GeoMedellín (CC)",
      });
      map.addLayer({
        id: "ortofoto",
        type: "raster",
        source: "ortofoto",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 1 },
      });

      // === Overlay de catastro AMVA (predios/manzanas) por municipio ===
      // Va sobre la imagen y debajo de las capas operativas (NAPs/clientes).
      // minzoom 13: solo carga al acercar (es dato detallado). Servido y cacheado
      // por el backend (/api/tiles/catastro), independiente del AMVA.
      for (const muni of ["medellin", "bello"]) {
        map.addSource(`catastro-${muni}`, {
          type: "raster",
          tiles: [`${API_URL}/tiles/catastro/${muni}?bbox={bbox-epsg-3857}`],
          tileSize: 512,
          minzoom: 13,
          maxzoom: 22,
        });
        map.addLayer({
          id: `catastro-${muni}`,
          type: "raster",
          source: `catastro-${muni}`,
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.8 },
        });
      }

      // --- Comuna 1: los 12 barrios reales (contexto) ---
      map.addSource("comuna1", { type: "geojson", data: data.comuna1 as any });
      map.addLayer({
        id: "comuna1-fill",
        type: "fill",
        source: "comuna1",
        paint: { "fill-color": "#3E6FB0", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "comuna1-line",
        type: "line",
        source: "comuna1",
        paint: { "line-color": "#3E6FB0", "line-width": 1, "line-opacity": 0.35 },
      });

      map.addSource("coverage", { type: "geojson", data: data.coverage as any });
      map.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        paint: {
          "fill-color": [
            "match",
            ["get", "estado"],
            "ftth", COVERAGE_COLORS.ftth,
            "parcial", COVERAGE_COLORS.parcial,
            "sin", COVERAGE_COLORS.sin,
            "#3E6FB0",
          ],
          "fill-opacity": 0.18,
        },
      });
      map.addLayer({
        id: "coverage-outline",
        type: "line",
        source: "coverage",
        paint: {
          "line-color": [
            "match",
            ["get", "estado"],
            "ftth", COVERAGE_COLORS.ftth,
            "parcial", COVERAGE_COLORS.parcial,
            "sin", COVERAGE_COLORS.sin,
            "#3E6FB0",
          ],
          "line-width": 1.5,
          "line-opacity": 0.7,
        },
      });

      map.addSource("sector", { type: "geojson", data: data.sector as any });
      map.addLayer({
        id: "sector-fill",
        type: "fill",
        source: "sector",
        paint: { "fill-color": "#F5C518", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "sector-line",
        type: "line",
        source: "sector",
        paint: {
          "line-color": "#F5C518",
          "line-width": 1.2,
          "line-opacity": 0.45,
        },
      });

      // Zonas de cobertura dibujadas por el operador (guardadas)
      map.addSource("zones", {
        type: "geojson",
        data: (data.zones as any) || { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": "#22E0A1", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: { "line-color": "#22E0A1", "line-width": 2, "line-opacity": 0.85 },
      });

      // Capa de dibujo en vivo (mientras el operador define una zona)
      map.addSource("draw", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-fill",
        type: "fill",
        source: "draw",
        filter: ["==", "$type", "Polygon"],
        paint: { "fill-color": "#F5C518", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "draw-line",
        type: "line",
        source: "draw",
        paint: { "line-color": "#F5C518", "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addLayer({
        id: "draw-vertices",
        type: "circle",
        source: "draw",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#F5C518",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      map.addSource("fiber", { type: "geojson", data: data.fiber as any });
      map.addLayer({
        id: "fiber-glow",
        type: "line",
        source: "fiber",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F5C518", "line-width": 6, "line-opacity": 0.18, "line-blur": 4 },
      });
      map.addLayer({
        id: "fiber-line",
        type: "line",
        source: "fiber",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFD24A", "line-width": 1.8, "line-opacity": 0.95 },
      });

      map.addSource("clients", { type: "geojson", data: data.clients as any });
      map.addLayer({
        id: "clients-glow",
        type: "circle",
        source: "clients",
        paint: {
          "circle-radius": 7,
          "circle-blur": 1,
          "circle-opacity": 0.5,
          "circle-color": ["match", ["get", "estado"], "suspendido", "#FF4D6D", "#3E6FB0"],
        },
      });
      map.addLayer({
        id: "clients-dot",
        type: "circle",
        source: "clients",
        paint: {
          "circle-radius": 3.2,
          "circle-color": ["match", ["get", "estado"], "suspendido", "#FF4D6D", "#7FA8DD"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.6)",
        },
      });

      // === Red REAL del Gemelo Digital (infra) — se traza con tus objetos ===
      map.addSource("infra-fiber", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "infra-fiber-glow",
        type: "line",
        source: "infra-fiber",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F5C518", "line-width": 7, "line-opacity": 0.2, "line-blur": 4 },
      });
      map.addLayer({
        id: "infra-fiber-line",
        type: "line",
        source: "infra-fiber",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFD24A", "line-width": 2.4, "line-opacity": 0.95 },
      });
      map.addSource("infra-assets", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "infra-assets-glow",
        type: "circle",
        source: "infra-assets",
        paint: {
          "circle-radius": ["match", ["get", "tipo"], "POP", 13, 8],
          "circle-blur": 1,
          "circle-opacity": 0.45,
          "circle-color": ["match", ["get", "tipo"],
            "POP", "#F5C518", "OLT", "#3E6FB0", "NAP", "#22E0A1", "CTO", "#22E0A1",
            "Splitter", "#7FA8DD", "Cliente", "#7FA8DD", "#8B96AC"],
        },
      });
      map.addLayer({
        id: "infra-assets-dot",
        type: "circle",
        source: "infra-assets",
        paint: {
          "circle-radius": ["match", ["get", "tipo"], "POP", 7, 4.5],
          "circle-color": ["match", ["get", "tipo"],
            "POP", "#F5C518", "OLT", "#3E6FB0", "NAP", "#22E0A1", "CTO", "#22E0A1",
            "Splitter", "#7FA8DD", "Cliente", "#7FA8DD", "#E9EDF5"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#04060C",
        },
      });
      // Badge: punto dorado que marca los activos que YA tienen evidencia
      // fotográfica. Es un círculo desplazado (no requiere glyphs en el estilo).
      map.addLayer({
        id: "infra-assets-cam",
        type: "circle",
        source: "infra-assets",
        filter: [">", ["coalesce", ["get", "fotosCount"], 0], 0],
        paint: {
          "circle-radius": 3,
          "circle-color": "#F5C518",
          "circle-translate": [7, -7],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#04060C",
        },
      });

      map.on("click", "clients-dot", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        const estado =
          p.estado === "suspendido"
            ? '<span style="color:#FF4D6D">● Suspendido</span>'
            : '<span style="color:#22E0A1">● Activo</span>';
        new Popup({ offset: 12 })
          .setLngLat((f.geometry as any).coordinates)
          .setHTML(`<div style="font-size:13px"><strong style="color:#fff">Cliente ${p.id}</strong><br/>${estado}</div>`)
          .addTo(map);
      });

      // Clic en zona vacía del mapa → consultar cobertura
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["clients-dot"] });
        if (hits.length) return; // fue clic en un cliente
        onMapClickRef.current?.(e.lngLat.lng, e.lngLat.lat);
      });

      map.getCanvas().style.cursor = "crosshair";

      buildNodeMarkers(map, data.nodes, markersRef, onNodeSelectRef);
      buildBarrioLabels(map, data.comuna1, labelsRef);
      applyVisibility(map, visibility, markersRef.current, labelsRef.current);

      // Enmarca el polígono real del barrio Popular
      if (data.meta.bbox) {
        const [minX, minY, maxX, maxY] = data.meta.bbox;
        map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 80, duration: 0 });
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      labelsRef.current.forEach((m) => m.remove());
      labelsRef.current = [];
      checkMarkerRef.current?.remove();
      checkMarkerRef.current = null;
      focusMarkerRef.current?.remove();
      focusMarkerRef.current = null;
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nodos en vivo → reconstruir marcadores
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    buildNodeMarkers(map, data.nodes, markersRef, onNodeSelectRef);
    applyVisibility(map, visibility, markersRef.current, labelsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nodes]);

  // Visibilidad de capas
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyVisibility(map, visibility, markersRef.current, labelsRef.current);
  }, [visibility]);

  // Resultado de consulta de cobertura → marcador en el punto
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    checkMarkerRef.current?.remove();
    checkMarkerRef.current = null;
    if (!checkResult) return;

    const color = checkResult.cobertura
      ? checkResult.estado === "ftth"
        ? "#22E0A1"
        : "#FFB02E"
      : "#FF4D6D";
    const el = document.createElement("div");
    el.style.cssText = `width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 0 16px ${color};`;
    checkMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([checkResult.lng, checkResult.lat])
      .addTo(map);
    map.flyTo({ center: [checkResult.lng, checkResult.lat], zoom: Math.max(map.getZoom(), 15.5), speed: 0.8 });
  }, [checkResult]);

  // Punto enfocado (previsualización de dirección geocodificada / alta de NAP)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    focusMarkerRef.current?.remove();
    focusMarkerRef.current = null;
    if (!focusPoint) return;

    const color = focusPoint.color || "#F5C518";
    const el = document.createElement("div");
    el.style.cssText = `width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 0 18px ${color};`;
    focusMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([focusPoint.lng, focusPoint.lat])
      .addTo(map);
    map.flyTo({ center: [focusPoint.lng, focusPoint.lat], zoom: Math.max(map.getZoom(), 16), speed: 0.8 });
  }, [focusPoint]);

  // Zonas guardadas → refrescar fuente
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("zones") as any;
    if (src) src.setData((data.zones as any) || emptyFC());
  }, [data.zones]);

  // Dibujo en vivo de la zona
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("draw") as any;
    if (src) src.setData(drawing && drawPoints ? drawFC(drawPoints) : emptyFC());
  }, [drawing, drawPoints]);

  // Pin ARRASTRABLE: ubicación seleccionada con precisión (clic, búsqueda o drag).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (!draggablePin) {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      lastFlyRef.current = null;
      return;
    }
    const color = pinColor || "#F5C518";
    const { lng, lat } = draggablePin;

    if (!pinMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = `width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 0 20px ${color};cursor:grab;`;
      const m = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true });
      m.on("dragstart", () => (el.style.cursor = "grabbing"));
      m.on("dragend", () => {
        el.style.cursor = "grab";
        const ll = m.getLngLat();
        onPinMoveRef.current?.(ll.lng, ll.lat);
      });
      m.setLngLat([lng, lat]).addTo(map);
      pinMarkerRef.current = m;
    } else {
      pinMarkerRef.current.setLngLat([lng, lat]);
      const el = pinMarkerRef.current.getElement();
      el.style.background = color;
      el.style.boxShadow = `0 0 20px ${color}`;
    }

    // Vuela solo en saltos grandes (clic/búsqueda), no al afinar arrastrando.
    const far =
      !lastFlyRef.current ||
      Math.hypot(lng - lastFlyRef.current[0], lat - lastFlyRef.current[1]) > 0.002;
    if (far) {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16.5), speed: 0.8 });
      lastFlyRef.current = [lng, lat];
    }
  }, [draggablePin, pinColor]);

  // Red real (infra) → refrescar fuentes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const fs = map.getSource("infra-fiber") as any;
    const as = map.getSource("infra-assets") as any;
    if (fs) fs.setData(infra?.fiber || emptyFC());
    if (as) as.setData(infra?.assets || emptyFC());
  }, [infra]);

  // Modo "solo mi red": oculta el demo (cobertura/clientes/nodos/fibra base) y deja la red real + barrios.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const demo = [
      "coverage-fill", "coverage-outline", "sector-fill", "sector-line",
      "fiber-glow", "fiber-line", "clients-glow", "clients-dot",
    ];
    demo.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showOnlyInfra ? "none" : "visible");
    });
    // Marcadores DOM de nodos demo
    markersRef.current.forEach((m) => {
      m.getElement().style.display = showOnlyInfra ? "none" : "";
    });
  }, [showOnlyInfra, infra]);

  // Conmuta entre base oscura y las distintas imágenes (satélite/ortofoto).
  // Esri siempre actúa de respaldo bajo Mapbox/Ortofoto para que nunca quede en
  // blanco. Al usar imagen se atenúan los rellenos de cobertura.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const sat = basemap !== "dark";
    const show = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    show("carto", basemap === "dark");
    // Esri solo en su modo; Mapbox HD (brillante, global) es la base en Satélite
    // y TAMBIÉN bajo la Ortofoto → Bello (Zamora/Santa Rita) se ve nítido y la
    // ortofoto 2024 de Medellín queda encima solo donde existe.
    show("sat-base", basemap === "esri");
    show("sat-hd", basemap === "satelite" || basemap === "ortofoto");
    show("ortofoto", basemap === "ortofoto");
    if (map.getLayer("coverage-fill")) {
      map.setPaintProperty("coverage-fill", "fill-opacity", sat ? 0.08 : 0.18);
    }
  }, [basemap]);

  // Overlay de catastro AMVA (predios/manzanas) on/off, sobre cualquier base.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const id of ["catastro-medellin", "catastro-bello"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", catastro ? "visible" : "none");
    }
  }, [catastro]);

  const BASEMAPS: { id: Basemap; label: string; show: boolean }[] = [
    { id: "dark", label: "◑ Mapa", show: true },
    { id: "satelite", label: "🛰️ Satélite HD", show: true },
    { id: "esri", label: "🌎 Esri", show: true },
    { id: "ortofoto", label: "🏙️ Ortofoto Medellín", show: true },
  ];

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Selector de base: oscuro operativo + imágenes (satélite/ortofoto) */}
      <div className="pointer-events-auto absolute left-3 top-3 z-10 flex overflow-hidden rounded-lg border border-white/10 bg-black/55 text-[11px] font-semibold shadow-lg backdrop-blur">
        {BASEMAPS.filter((b) => b.show).map((b) => (
          <button
            key={b.id}
            onClick={() => setBasemap(b.id)}
            className={`px-3 py-1.5 transition-colors ${
              basemap === b.id ? "bg-cica-gold text-black" : "text-cica-silver hover:bg-white/10"
            }`}
          >
            {b.label}
          </button>
        ))}
        <button
          onClick={() => setCatastro((v) => !v)}
          title="Predios y manzanas (catastro AMVA)"
          className={`border-l border-white/10 px-3 py-1.5 transition-colors ${
            catastro ? "bg-status-ftth text-black" : "text-cica-silver hover:bg-white/10"
          }`}
        >
          🧩 Catastro
        </button>
      </div>
    </div>
  );
}

function emptyFC(): any {
  return { type: "FeatureCollection", features: [] };
}

/** FeatureCollection para el dibujo en vivo: vértices + línea + polígono tentativo. */
function drawFC(points: [number, number][]): any {
  const feats: any[] = points.map((p) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: p },
    properties: {},
  }));
  if (points.length >= 2) {
    feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
  }
  if (points.length >= 3) {
    feats.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
      properties: {},
    });
  }
  return { type: "FeatureCollection", features: feats };
}

function buildNodeMarkers(
  map: MlMap,
  nodes: FC,
  markersRef: React.MutableRefObject<Marker[]>,
  onNodeSelectRef: React.MutableRefObject<((p: any) => void) | undefined>,
) {
  markersRef.current.forEach((m) => m.remove());
  markersRef.current = [];

  nodes.features.forEach((f: any) => {
    const p = f.properties;
    const el = document.createElement("div");
    el.className = p.tipo === "POP" ? "pop-marker" : napClass(p.puertos_usados, p.puertos_total, p.estado);

    const libres = p.puertos_total - p.puertos_usados;
    const popup = new Popup({ offset: 16 }).setHTML(
      `<div style="font-size:13px;min-width:160px">
        <strong style="color:#fff;font-size:14px">${p.nombre}</strong>
        <div style="color:#8B96AC;margin:2px 0 8px">${p.tipo} · ${
        p.estado === "online"
          ? '<span style="color:#22E0A1">online</span>'
          : '<span style="color:#FFB02E">degradado</span>'
      }</div>
        <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#8B96AC">Puertos</span><strong style="color:#fff">${p.puertos_usados}/${p.puertos_total}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#8B96AC">Libres</span><strong style="color:${libres > 0 ? "#F5C518" : "#FF4D6D"}">${libres}</strong></div>
      </div>`,
    );

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(f.geometry.coordinates)
      .setPopup(popup)
      .addTo(map);
    el.addEventListener("click", () => onNodeSelectRef.current?.(p));
    markersRef.current.push(marker);
  });
}

function buildBarrioLabels(map: MlMap, comuna1: FC, labelsRef: React.MutableRefObject<Marker[]>) {
  labelsRef.current.forEach((m) => m.remove());
  labelsRef.current = [];
  comuna1.features.forEach((f: any) => {
    const c = bboxCenter(f.geometry.coordinates);
    if (!c) return;
    const el = document.createElement("div");
    const esPopular = f.properties.codigo === "0103";
    el.textContent = f.properties.nombre;
    el.style.cssText = `font-size:${esPopular ? 11 : 9.5}px;font-weight:${esPopular ? 800 : 600};
      color:${esPopular ? "#F5C518" : "#8B96AC"};white-space:nowrap;pointer-events:none;
      text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.8);letter-spacing:0.2px;`;
    const marker = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map);
    labelsRef.current.push(marker);
  });
}

// Centro del bbox de una geometría Polygon/MultiPolygon
function bboxCenter(coords: any): [number, number] | null {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, found = false;
  const walk = (a: any) => {
    if (typeof a[0] === "number") {
      found = true;
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
      minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
    } else a.forEach(walk);
  };
  walk(coords);
  return found ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}

function applyVisibility(map: MlMap, v: LayerVisibility, markers: Marker[], labels: Marker[]) {
  const set = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  set("comuna1-fill", v.barrios);
  set("comuna1-line", v.barrios);
  set("coverage-fill", v.cobertura);
  set("coverage-outline", v.cobertura);
  set("fiber-line", v.fibra);
  set("fiber-glow", v.fibra);
  set("clients-dot", v.clientes);
  set("clients-glow", v.clientes);
  markers.forEach((m) => {
    m.getElement().style.display = v.nodos ? "" : "none";
  });
  labels.forEach((m) => {
    m.getElement().style.display = v.barrios ? "" : "none";
  });
}
