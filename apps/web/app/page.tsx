"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import type { MapData } from "../components/CoverageMap";
import AppShell, { type Section } from "../components/AppShell";
import OperacionPanel from "../components/panels/OperacionPanel";
import ClientesPanel from "../components/panels/ClientesPanel";
import InfraPanel from "../components/panels/InfraPanel";
import OrdenesPanel from "../components/panels/OrdenesPanel";
import ContabilidadModule from "../components/contabilidad/ContabilidadModule";
import SoportePanel from "../components/panels/SoportePanel";
import TicketsPanel from "../components/panels/TicketsPanel";
import UsuariosPanel from "../components/panels/UsuariosPanel";
import CicaAssistant from "../components/CicaAssistant";
import ClientesModule from "../components/clientes/ClientesModule";
import {
  SOCKET_URL,
  getToken,
  getUser,
  clearSession,
  fetchBundle,
  checkCoverage,
  reverseGeocode,
  ipLocate,
  listNaps,
  listZones,
  createZone,
  infraBundle,
  clientesStats,
  evaluateConstruction,
  createInfraAsset,
  createInfraFiber,
  listTickets,
  ticketStats,
  whatsappHandoffsResumen,
  type SessionUser,
  type CoverageResult,
  type IpLocation,
  type NapRecord,
  type ZoneRecord,
  type InfraBundle,
  type ClienteStats,
  type ConstructionResult,
  type TicketStats,
} from "../lib/api";

const CoverageMap = dynamic(() => import("../components/CoverageMap"), { ssr: false });
const InfraMap = dynamic(() => import("../components/InfraMap"), { ssr: false });

type LayerKey = "barrios" | "cobertura" | "fibra" | "nodos" | "clientes";

export default function Page() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [stats, setStats] = useState<any | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [section, setSection] = useState<Section>("dashboard");
  const [visibility, setVisibility] = useState<Record<LayerKey, boolean>>({
    barrios: true, cobertura: true, fibra: true, nodos: true, clientes: true,
  });
  const [selectedNode, setSelectedNode] = useState<Record<string, any> | null>(null);
  const [infraSelId, setInfraSelId] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [pin, setPin] = useState<{ lng: number; lat: number } | null>(null);
  const [pinAddress, setPinAddress] = useState<string | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ lng: number; lat: number; color?: string } | null>(null);
  const [naps, setNaps] = useState<NapRecord[]>([]);
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [infra, setInfra] = useState<InfraBundle | null>(null);
  const [cliStats, setCliStats] = useState<ClienteStats | null>(null);
  const [tickStats, setTickStats] = useState<TicketStats | null>(null);
  const [soportePend, setSoportePend] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  // Trazado de fibra poste a poste (polilínea abierta).
  const [routing, setRouting] = useState(false);
  const [routePoints, setRoutePoints] = useState<[number, number][]>([]);
  // Id del activo al que hizo snap cada vértice (para conectar la fibra a la topología).
  const [routeSnaps, setRouteSnaps] = useState<(string | null)[]>([]);
  // Modo "colocar activo": el siguiente clic en el mapa ubica un activo de este tipo.
  const [placeTipo, setPlaceTipo] = useState<string | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [ipLoc, setIpLoc] = useState<IpLocation | null>(null);
  // Modo construcción / simulador de venta
  const [buildMode, setBuildMode] = useState(false);
  const [buildResult, setBuildResult] = useState<ConstructionResult | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u || !getToken()) { router.replace("/login"); return; }
    setUser(u);
    // La contadora entra directo a su workspace (no ve el dashboard operativo).
    if (u.role === "contador") setSection("contabilidad");

    fetchBundle()
      .then((b) => {
        setData({ meta: b.meta, comuna1: b.comuna1, sector: b.sector, coverage: b.coverage, fiber: b.fiber, clients: b.clients, nodes: b.nodes, zones: b.zones });
        setStats(b.stats);
      })
      .catch((e) => setError(e.message));

    listNaps().then(setNaps).catch(() => {});
    listZones().then(setZones).catch(() => {});
    infraBundle().then(setInfra).catch(() => {});
    clientesStats().then(setCliStats).catch(() => {});
    ticketStats().then(setTickStats).catch(() => {});

    ipLocate()
      .then((loc) => { setIpLoc(loc); if (loc.fuente === "ip-api") setFocusPoint({ lng: loc.lng, lat: loc.lat, color: "#3B82F6" }); })
      .catch(() => {});

    const socket = io(SOCKET_URL, {
      auth: { token: getToken() },
      transports: ["polling", "websocket"],
      // ngrok (free) intercala una página de advertencia en peticiones de
      // navegador sin este header; sin él, el handshake de Socket.IO recibe HTML
      // y entra en bucle de reconexión a través del túnel. authFetch ya lo envía
      // para el API; aquí lo añadimos al transporte polling del socket.
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
    });
    socketRef.current = socket;
    socket.on("connect", () => setLive(true));
    socket.on("disconnect", () => setLive(false));
    socket.on("nodes:update", (nodes: any) => setData((d) => (d ? { ...d, nodes } : d)));
    socket.on("stats:update", (s: any) => setStats(s));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [router]);

  // Contadores del menú (bolitas): solicitudes de asesor y tickets pendientes.
  // Solo staff que ve esos paneles (admin/operador). Se refrescan cada 15s.
  useEffect(() => {
    if (!user || !(user.role === "admin" || user.role === "operador")) return;
    let cancelled = false;
    const cargar = () => {
      whatsappHandoffsResumen().then((r) => { if (!cancelled) setSoportePend(r.pendientes); }).catch(() => {});
      ticketStats().then((s) => { if (!cancelled) setTickStats(s); }).catch(() => {});
    };
    cargar();
    const t = setInterval(cargar, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user]);

  const toggle = (k: LayerKey) => setVisibility((v) => ({ ...v, [k]: !v[k] }));

  async function runCheck(lng: number, lat: number) {
    setChecking(true);
    try { setCoverage(await checkCoverage(lng, lat)); }
    catch (e: any) { setError(e.message); }
    finally { setChecking(false); }
  }

  function placePin(lng: number, lat: number) {
    setFocusPoint(null);
    setPin({ lng, lat });
    setPinAddress(null);
    runCheck(lng, lat);
    reverseGeocode(lat, lng).then((r) => setPinAddress(r.direccion)).catch(() => {});
  }

  function onCheckAddress(lng: number, lat: number) { placePin(lng, lat); }

  // ---- Modo construcción (simulador de venta) ----
  async function runBuild(lng: number, lat: number) {
    setFocusPoint(null);
    setCoverage(null);
    setPin({ lng, lat });
    setPinAddress(null);
    reverseGeocode(lat, lng).then((r) => setPinAddress(r.direccion)).catch(() => {});
    try { setBuildResult(await evaluateConstruction(lng, lat)); }
    catch (e: any) { setError(e.message); }
  }
  function toggleBuildMode() {
    setBuildMode((on) => {
      const next = !on;
      if (next) { setCoverage(null); setFocusPoint(null); }
      else { setBuildResult(null); setPin(null); }
      return next;
    });
  }

  function focusOn(lng: number, lat: number, color?: string) {
    setCoverage(null); setPin(null); setPinAddress(null);
    setFocusPoint({ lng, lat, color });
  }

  // Abre el mapa centrado en un punto (desde el Customer 360 → "Ver en mapa").
  function verEnMapa(lng: number, lat: number) {
    setSection("red");
    setDrawing(false); setBuildMode(false); setBuildResult(null);
    setRouting(false); setRoutePoints([]); setRouteSnaps([]); setPlaceTipo(null);
    setCoverage(null); setPin(null); setPinAddress(null);
    setFocusPoint({ lng, lat, color: "#22E0A1" });
  }

  const pinColor = buildResult
    ? buildResult.resultado === "instalable" ? "#22E0A1" : "#FF4D6D"
    : !coverage
    ? "#22D3EE"
    : coverage.cobertura
    ? coverage.estado === "ftth" ? "#22E0A1" : "#FFB02E"
    : coverage.estado === "fuera_de_zona" ? "#8B96AC" : "#FF4D6D";

  async function refreshBundle() {
    try {
      const b = await fetchBundle();
      setData((d) => (d ? { ...d, coverage: b.coverage, fiber: b.fiber, nodes: b.nodes, zones: b.zones } : d));
      setStats(b.stats);
      setNaps(await listNaps());
      setZones(await listZones());
    } catch (e: any) { setError(e.message); }
  }
  async function refreshInfra() {
    try { setInfra(await infraBundle()); } catch (e: any) { setError(e.message); }
  }
  function refreshCliStats() { clientesStats().then(setCliStats).catch(() => {}); ticketStats().then(setTickStats).catch(() => {}); }

  // ---- Dibujo de zona ----
  function startDraw() { setSection("infra"); setDrawing(true); setDrawPoints([]); setFocusPoint(null); setCoverage(null); }
  function cancelDraw() { setDrawing(false); setDrawPoints([]); }
  function undoPoint() { setDrawPoints((pts) => pts.slice(0, -1)); }
  async function saveZone(nombre: string) {
    if (drawPoints.length < 3) return;
    try { await createZone(nombre, drawPoints); setDrawing(false); setDrawPoints([]); await refreshBundle(); }
    catch (e: any) { setError(e.message); }
  }
  function onMapClickRouter(lng: number, lat: number, snappedId?: string | null) {
    if (drawing) { setDrawPoints((pts) => [...pts, [lng, lat]]); return; }
    if (routing) { setRoutePoints((pts) => [...pts, [lng, lat]]); setRouteSnaps((s) => [...s, snappedId ?? null]); return; }
    if (placeTipo) { placeAssetAt(lng, lat, placeTipo); return; }
    if (section === "infra") { if (buildMode) runBuild(lng, lat); return; }
    placePin(lng, lat);
  }

  // ---- Trazado de fibra poste a poste ----
  function startRoute() {
    setSection("infra");
    setRouting(true); setRoutePoints([]); setRouteSnaps([]);
    setDrawing(false); setPlaceTipo(null);
    setBuildMode(false); setBuildResult(null);
    setFocusPoint(null); setCoverage(null); setPin(null);
  }
  function undoRoutePoint() { setRoutePoints((pts) => pts.slice(0, -1)); setRouteSnaps((s) => s.slice(0, -1)); }
  function cancelRoute() { setRouting(false); setRoutePoints([]); setRouteSnaps([]); }
  async function finishRoute(opts: { nombre?: string; tipoFibra?: "monomodo" | "multimodo"; hilos?: number }) {
    if (routePoints.length < 2) return;
    // Si el primer/último vértice hizo snap a un activo, la fibra queda conectada a él.
    const origenId = routeSnaps[0] || undefined;
    const destinoId = routeSnaps[routeSnaps.length - 1] || undefined;
    try {
      await createInfraFiber({ trazado: routePoints, origenId, destinoId, ...opts });
      setRouting(false); setRoutePoints([]); setRouteSnaps([]);
      await refreshInfra();
    } catch (e: any) { setError(e.message); }
  }

  // ---- Atajos de teclado del editor (estilo iD) ----
  function onEditorShortcut(action: "poste" | "nap" | "empalme" | "splitter" | "cable" | "cancel" | "undo") {
    switch (action) {
      case "poste": startPlace("Poste"); break;
      case "nap": startPlace("NAP"); break;
      case "empalme": startPlace("Empalme"); break;
      case "splitter": startPlace("Splitter"); break;
      case "cable": startRoute(); break;
      case "undo": if (routing) undoRoutePoint(); break;
      case "cancel": setRouting(false); setRoutePoints([]); setRouteSnaps([]); setPlaceTipo(null); if (drawing) cancelDraw(); break;
    }
  }

  // ---- Colocar activo (poste/NAP) con un clic en el mapa ----
  function startPlace(tipo: string) {
    setSection("infra");
    setPlaceTipo(tipo);
    setRouting(false); setRoutePoints([]); setDrawing(false);
    setBuildMode(false); setBuildResult(null);
    setFocusPoint(null); setCoverage(null); setPin(null);
  }
  function stopPlace() { setPlaceTipo(null); }
  async function placeAssetAt(lng: number, lat: number, tipo: string) {
    if (placeBusy) return;
    setPlaceBusy(true);
    try {
      await createInfraAsset({
        tipo, lng, lat,
        puertosTotal: tipo === "NAP" ? 16 : undefined,
        puertosUsados: tipo === "NAP" ? 0 : undefined,
      });
      await refreshInfra(); // el nuevo activo aparece donde hiciste clic; el modo sigue activo para ubicar más.
    } catch (e: any) { setError(e.message); }
    finally { setPlaceBusy(false); }
  }

  function changeSection(s: Section) {
    setSection(s);
    setFocusPoint(null);
    if (s !== "infra" && drawing) cancelDraw();
    if (s !== "infra" && buildMode) { setBuildMode(false); setBuildResult(null); }
    if (s !== "infra") { setRouting(false); setRoutePoints([]); setRouteSnaps([]); setPlaceTipo(null); }
  }
  function logout() { socketRef.current?.disconnect(); clearSession(); router.replace("/login"); }

  const canEdit = user?.role === "admin" || user?.role === "operador";
  const napOptions = useMemo(
    () => (infra?.assets.features || [])
      .filter((f: any) => f.properties.tipo === "NAP" || f.properties.tipo === "CTO")
      .map((f: any) => ({ id: f.properties.id, nombre: f.properties.nombre })),
    [infra],
  );

  const isMapSection = section === "red" || section === "infra";

  return (
    <AppShell section={section} onSection={changeSection} user={user} onLogout={logout} live={live} ipLoc={ipLoc} badges={{ soporte: soportePend, tickets: (tickStats?.porEstado.abierto ?? 0) + (tickStats?.porEstado.en_proceso ?? 0) }}>
      {/* ===== Dashboard ===== */}
      {section === "dashboard" && (
        <div className="h-full overflow-y-auto p-6">
          <Dashboard cli={cliStats} infra={infra} naps={naps} onGo={changeSection} tick={tickStats} />
        </div>
      )}

      {/* ===== Clientes ===== */}
      {section === "clientes" && (
        <div className="h-full overflow-y-auto p-6">
          <ClientesModule canEdit={!!canEdit} napOptions={napOptions} stats={cliStats} onChanged={refreshCliStats} onVerEnMapa={verEnMapa} />
        </div>
      )}

      {/* ===== Soporte ===== */}
      {section === "soporte" && (
        <div className="h-full overflow-y-auto p-6">
          <SoportePanel canEdit={user?.role === "admin"} />
        </div>
      )}

      {/* ===== Tickets ===== */}
      {section === "tickets" && (
        <div className="h-full overflow-y-auto p-6">
          <TicketsPanel onVerEnMapa={verEnMapa} />
        </div>
      )}

      {/* ===== Órdenes de trabajo ===== */}
      {section === "ordenes" && (
        <div className="h-full overflow-y-auto p-6">
          <OrdenesPanel canEdit={!!canEdit} />
        </div>
      )}

      {/* ===== Contabilidad ===== */}
      {section === "contabilidad" && (
        <div className="h-full overflow-y-auto p-6">
          <ContabilidadModule canEdit={user?.role === "admin" || user?.role === "contador"} isAdmin={user?.role === "admin"} />
        </div>
      )}

      {/* ===== Usuarios (solo admin) ===== */}
      {section === "usuarios" && (
        <div className="h-full overflow-y-auto p-6">
          <UsuariosPanel currentUserId={user?.id} />
        </div>
      )}

      {/* ===== Secciones con mapa ===== */}
      {isMapSection && (
        <div className="flex h-full flex-col md:flex-row">
          <aside className="max-h-[45%] w-full shrink-0 overflow-y-auto border-b border-cica-border/70 bg-cica-navy/40 p-4 md:max-h-none md:w-[336px] md:border-b-0 md:border-r">
            {section === "red" && (
              <div className="flex flex-col gap-3">
                <ClientesPanel onCheckAddress={onCheckAddress} coverage={coverage} checking={checking} pinAddress={pinAddress} pin={pin} />
                <OperacionPanel infra={infra} visibility={visibility} onToggle={toggle} coverage={coverage} checking={checking} />
              </div>
            )}
            {section === "infra" && (
              <InfraPanel
                naps={naps} zones={zones} canEdit={!!canEdit} onFocus={focusOn} onChanged={refreshBundle}
                drawing={drawing} drawPointsCount={drawPoints.length}
                onStartDraw={startDraw} onUndoPoint={undoPoint} onCancelDraw={cancelDraw} onSaveZone={saveZone}
                infra={infra} onInfraChanged={refreshInfra}
                buildMode={buildMode} buildResult={buildResult} onToggleBuild={toggleBuildMode}
                routing={routing} routePointsCount={routePoints.length}
                onStartRoute={startRoute} onUndoRoutePoint={undoRoutePoint} onCancelRoute={cancelRoute} onFinishRoute={finishRoute}
                placeTipo={placeTipo} onStartPlace={startPlace} onStopPlace={stopPlace}
              />
            )}
          </aside>

          <div className="relative min-w-0 flex-1">
            {data ? (
              section === "infra" ? (
                <InfraMap
                  assets={infra?.assets ?? { type: "FeatureCollection", features: [] }}
                  fiber={infra?.fiber ?? { type: "FeatureCollection", features: [] }}
                  barrios={data.comuna1}
                  zones={data.zones}
                  onSelect={(p) => setInfraSelId(p.id)}
                  selectedId={infraSelId}
                  focusPoint={focusPoint}
                  onMapClick={onMapClickRouter}
                  drawing={drawing}
                  drawPoints={drawPoints}
                  routing={routing}
                  routePoints={routePoints}
                  placing={!!placeTipo}
                  onShortcut={onEditorShortcut}
                  draggablePin={pin}
                  pinColor={pinColor}
                  onPinMove={placePin}
                />
              ) : (
                <CoverageMap
                  data={data} visibility={visibility} onNodeSelect={setSelectedNode}
                  onMapClick={onMapClickRouter}
                  focusPoint={focusPoint} drawing={drawing} drawPoints={drawPoints}
                  draggablePin={pin} pinColor={pinColor} onPinMove={placePin}
                  infra={infra ? { assets: infra.assets, fiber: infra.fiber } : null}
                  showOnlyInfra={true}
                />
              )
            ) : (
              <div className="absolute inset-0 grid place-items-center text-cica-muted">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
                  <span className="text-sm">{error ? `Error: ${error}` : "Cargando mapa…"}</span>
                </div>
              </div>
            )}

            {/* Leyenda */}
            <div className="glass-soft absolute bottom-5 left-5 z-10 px-4 py-3">
              {section === "infra" ? (
                <>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Infraestructura</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-cica-silver">
                    <LegendDot color="#22D3EE" label="POP / Central" />
                    <LegendDot color="#3B82F6" label="OLT" />
                    <LegendDot color="#22E0A1" label="NAP / Caja" />
                    <LegendDot color="#38BDF8" label="Splitter" />
                    <LegendDot color="#A3E635" label="Empalme" />
                    <LegendDot color="#818CF8" label="Fibra" />
                    <LegendDot color="#2DD4BF" label="Enlace topología" />
                    <LegendDot color="#38BDF8" label="Cliente" />
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Estado de cobertura</div>
                  <div className="flex flex-col gap-1.5 text-xs text-cica-silver">
                    <LegendDot color="#22E0A1" label="FTTH disponible" />
                    <LegendDot color="#FFB02E" label="Cobertura parcial / NAP saturada" />
                    <LegendDot color="#FF4D6D" label="Sin cobertura / suspendido" />
                    <LegendDot color="#22D3EE" label="Fibra troncal" />
                    <LegendDot color="#3B82F6" label="Cliente activo" />
                  </div>
                </>
              )}
            </div>

            {/* Detalle de nodo (solo en Red & Mapa; Infra usa su propio popup/ficha) */}
            {section === "red" && selectedNode && (
              <div className="glass absolute bottom-5 right-5 z-10 w-[260px] animate-fadeUp p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-extrabold text-white">{selectedNode.nombre}</div>
                    <div className="text-[11px] text-cica-muted">
                      {selectedNode.tipo} · {selectedNode.estado === "online" ? <span className="text-status-ftth">online</span> : <span className="text-status-parcial">degradado</span>}
                    </div>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="text-cica-muted hover:text-white">✕</button>
                </div>
                {selectedNode.direccion && <div className="mt-1 text-[10px] text-cica-muted line-clamp-2">{selectedNode.direccion}</div>}
                {"puertos_total" in selectedNode && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[11px] text-cica-muted">
                      <span>Ocupación de puertos</span>
                      <span className="font-semibold text-cica-silver">{selectedNode.puertos_usados}/{selectedNode.puertos_total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-cica-border">
                      <div className="h-full rounded-full bg-gradient-to-r from-cica-amber to-cica-gold" style={{ width: `${(selectedNode.puertos_usados / selectedNode.puertos_total) * 100}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Asistente virtual flotante (disponible en todo el panel) */}
      <CicaAssistant />
    </AppShell>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span>{label}</span>
    </div>
  );
}

/* ===================== Dashboard ===================== */

function Dashboard({
  cli, infra, naps, onGo, tick,
}: {
  cli: ClienteStats | null;
  infra: InfraBundle | null;
  naps: NapRecord[];
  onGo: (s: Section) => void;
  tick: TicketStats | null;
}) {
  const puertosTotal = naps.reduce((s, n) => s + (n.puertos_total || 0), 0);
  const puertosUsados = naps.reduce((s, n) => s + (n.puertos_usados || 0), 0);
  const librePct = puertosTotal > 0 ? Math.round(((puertosTotal - puertosUsados) / puertosTotal) * 100) : null;
  const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
  const km = ((infra?.stats.metrosFibra ?? 0) / 1000).toFixed(1);

  return (
    <div className="mx-auto max-w-6xl">
      <h2 className="mb-1 text-xl font-extrabold text-white">Resumen operativo</h2>
      <p className="mb-5 text-xs text-cica-muted">Estado general de la red y la base de suscriptores.</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Suscriptores" value={cli ? String(cli.total) : "—"} sub="en la base" accent="text-cica-gold" onClick={() => onGo("clientes")} />
        <Card label="Servicio activo" value={cli ? String(cli.porServicio.activo || 0) : "—"} sub="conexiones activas" accent="text-status-ftth" onClick={() => onGo("clientes")} />
        <Card label="Ingreso mensual" value={cli ? money(cli.ingresoMensual) : "—"} sub="clientes activos" accent="text-cica-silver" />
        <Card label="Cartera pendiente" value={cli ? money(cli.saldoPendiente) : "—"} sub="por cobrar" accent={cli && cli.saldoPendiente > 0 ? "text-status-sin" : "text-cica-silver"} />
        <Card label="Equipos de red" value={String(infra?.stats.activos ?? 0)} sub="activos" accent="text-cica-gold" onClick={() => onGo("infra")} />
        <Card label="NAP / CTO" value={String((infra?.assets.features || []).filter((f: any) => f.properties.tipo === "NAP" || f.properties.tipo === "CTO").length)} sub="puntos de acceso" accent="text-status-ftth" onClick={() => onGo("infra")} />
        <Card label="Fibra tendida" value={`${km} km`} sub={`${infra?.stats.fibras ?? 0} tramos`} accent="text-cica-glow" onClick={() => onGo("infra")} />
        <Card label="Capacidad libre" value={librePct === null ? "—" : `${librePct}%`} sub="puertos disponibles" accent={librePct !== null && librePct < 20 ? "text-status-sin" : "text-cica-steelLight"} />
        <Card label="Tickets abiertos" value={tick ? String(tick.porEstado.abierto ?? 0) : "—"} sub="pendientes" accent={(tick?.porEstado.abierto ?? 0) > 0 ? "text-status-sin" : "text-cica-muted"} onClick={() => onGo("tickets")} />
      </div>

      {cli && cli.total > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Breakdown title="Suscriptores por estado" data={cli.porEstado} />
          <Breakdown title="Por tecnología" data={cli.porTecnologia} />
        </div>
      )}
    </div>
  );
}

function Card({ label, value, sub, accent, onClick }: { label: string; value: string; sub: string; accent: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={`glass p-4 text-left transition-colors ${onClick ? "hover:border-cica-gold/40" : "cursor-default"}`}>
      <div className={`text-2xl font-extrabold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-cica-silver">{label}</div>
      <div className="text-[10px] text-cica-muted">{sub}</div>
    </button>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="glass p-4">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-cica-muted">{title}</div>
      <div className="flex flex-col gap-2">
        {entries.length === 0 ? <span className="text-[11px] text-cica-muted">Sin datos.</span> : entries.map(([k, v]) => (
          <div key={k}>
            <div className="mb-0.5 flex justify-between text-[11px]"><span className="capitalize text-cica-silver">{k.replace(/_/g, " ")}</span><span className="text-cica-muted">{v}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-cica-border"><div className="h-full rounded-full bg-gradient-to-r from-cica-amber to-cica-gold" style={{ width: `${(v / total) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
