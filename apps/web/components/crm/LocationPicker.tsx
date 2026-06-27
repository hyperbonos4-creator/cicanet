"use client";

// ============================================================
//  LocationPicker — selector de ubicación EXACTA de la casa.
//  Pensado para zonas donde Google no puede navegar (callejones,
//  escaleras): el operador/cliente ve la ortofoto/satélite y marca
//  con un clic el punto exacto. Devuelve lat/lng precisos.
// ============================================================

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Marker } from "maplibre-gl";
import { API_URL, geocode } from "../../lib/api";

type Base = "satelite" | "ortofoto" | "mapa";

const STREETS: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "&copy; CARTO &copy; OpenStreetMap",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0B1020" } },
    { id: "carto", type: "raster", source: "carto" },
  ],
};

export default function LocationPicker({
  lat,
  lng,
  address,
  onChange,
}: {
  lat?: number;
  lng?: number;
  address?: string;
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const loadedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [base, setBase] = useState<Base>("satelite");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null,
  );
  const [geocoding, setGeocoding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Coloca/mueve el marcador exacto y reporta la coordenada hacia el formulario.
  function place(lngV: number, latV: number, fly = false) {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#22E0A1;border:3px solid #fff;box-shadow:0 0 16px #22E0A1;cursor:grab;";
      const m = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true });
      m.on("dragend", () => {
        const ll = m.getLngLat();
        setCoords({ lat: ll.lat, lng: ll.lng });
        onChangeRef.current(ll.lat, ll.lng);
      });
      markerRef.current = m;
      m.setLngLat([lngV, latV]).addTo(map);
    } else {
      markerRef.current.setLngLat([lngV, latV]);
    }
    setCoords({ lat: latV, lng: lngV });
    onChangeRef.current(latV, lngV);
    if (fly) map.flyTo({ center: [lngV, latV], zoom: Math.max(map.getZoom(), 18), speed: 0.9 });
  }

  // init (una vez)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start: [number, number] =
      lng != null && lat != null ? [lng, lat] : [-75.555, 6.299];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STREETS,
      center: start,
      zoom: lng != null && lat != null ? 18 : 14,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      loadedRef.current = true;
      // Capas de imagen (satélite Google + Esri respaldo + ortofotos oficiales).
      map.addSource("sat-esri", {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar",
      });
      map.addLayer({ id: "sat-esri", type: "raster", source: "sat-esri", layout: { visibility: "none" } });
      map.addSource("sat-gsat", {
        type: "raster", tiles: [`${API_URL}/tiles/gsat/{z}/{x}/{y}`], tileSize: 256, maxzoom: 22, attribution: "Imagery © Google",
      });
      map.addLayer({ id: "sat-gsat", type: "raster", source: "sat-gsat", layout: { visibility: "none" } });
      map.addSource("ortofoto", {
        type: "raster", tiles: [`${API_URL}/tiles/medellin/{z}/{y}/{x}`], tileSize: 256, maxzoom: 22, attribution: "Ortofoto © Alcaldía de Medellín",
      });
      map.addLayer({ id: "ortofoto", type: "raster", source: "ortofoto", layout: { visibility: "none" } });
      map.addSource("ortofoto-amva", {
        type: "raster", tiles: [`${API_URL}/tiles/ortofoto-amva?bbox={bbox-epsg-3857}`], tileSize: 512, minzoom: 12, maxzoom: 19, attribution: "Ortofoto © AMVA",
      });
      map.addLayer({ id: "ortofoto-amva", type: "raster", source: "ortofoto-amva", layout: { visibility: "none" } }, "ortofoto");
      applyBase(map, base);
      if (lng != null && lat != null) place(lng, lat);
    });

    // Clic en el mapa = ubicar la casa EXACTA en ese punto.
    map.on("click", (e) => { place(e.lngLat.lng, e.lngLat.lat); });
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      markerRef.current?.remove(); markerRef.current = null;
      map.remove(); mapRef.current = null; loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cambio de base
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyBase(map, base);
  }, [base]);

  // Centra en la dirección escrita (geocodificación) para ubicar rápido la zona.
  async function buscarDireccion() {
    if (!address || address.trim().length < 3) { setMsg("Escribe primero la dirección arriba."); return; }
    setGeocoding(true); setMsg(null);
    try {
      const cands = await geocode(address.trim());
      if (!cands.length) { setMsg("No se encontró la dirección; ubícala manualmente con un clic."); return; }
      const c = cands[0];
      place(c.lng, c.lat, true);
      setMsg("Ajusta el pin al punto EXACTO de la casa.");
    } catch (e: any) {
      setMsg(e.message || "No se pudo geocodificar.");
    } finally { setGeocoding(false); }
  }

  // Usa el GPS del dispositivo (técnico parado frente a la casa = punto exacto).
  function usarGps() {
    if (!navigator.geolocation) { setMsg("Este dispositivo no soporta geolocalización."); return; }
    setMsg("Obteniendo ubicación GPS…");
    navigator.geolocation.getCurrentPosition(
      (pos) => { place(pos.coords.longitude, pos.coords.latitude, true); setMsg("Ubicación GPS marcada. Ajústala si hace falta."); },
      () => setMsg("No se pudo obtener el GPS (permiso denegado)."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-cica-border text-[10px] font-semibold">
          {([["satelite", "🛰️ Satélite"], ["ortofoto", "🏙️ Ortofoto"], ["mapa", "🗺️ Mapa"]] as [Base, string][]).map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setBase(id)} className={`px-2.5 py-1 transition-colors ${base === id ? "bg-cica-gold text-black" : "text-cica-silver hover:bg-white/10"}`}>{lbl}</button>
          ))}
        </div>
        <button type="button" onClick={buscarDireccion} disabled={geocoding} className="rounded-lg border border-cica-glow/40 bg-cica-glow/10 px-2.5 py-1 text-[10px] font-semibold text-cica-glow hover:bg-cica-glow/20 disabled:opacity-50">
          {geocoding ? "Buscando…" : "📍 Centrar en la dirección"}
        </button>
        <button type="button" onClick={usarGps} className="rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-2.5 py-1 text-[10px] font-semibold text-status-ftth hover:bg-status-ftth/20">
          🎯 Usar mi GPS
        </button>
      </div>

      <div ref={containerRef} className="h-72 w-full overflow-hidden rounded-xl border border-cica-border" />

      <div className="flex items-center justify-between text-[10px]">
        <span className="text-cica-muted">Haz clic en el mapa o arrastra el pin para marcar la casa exacta.</span>
        {coords ? (
          <span className="font-mono text-status-ftth">{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</span>
        ) : (
          <span className="text-cica-muted">Sin ubicación marcada</span>
        )}
      </div>
      {msg && <div className="text-[10px] text-cica-gold">{msg}</div>}
    </div>
  );
}

function applyBase(map: MlMap, base: Base) {
  const set = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
  set("carto", base === "mapa");
  set("sat-esri", base !== "mapa");
  set("sat-gsat", base !== "mapa");
  set("ortofoto", base === "ortofoto");
  set("ortofoto-amva", base === "ortofoto");
}
