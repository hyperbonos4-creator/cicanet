"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import type { MapData } from "../components/network/CoverageMap";
import AppShell, { type Section } from "../components/shell/AppShell";
import NetworkWorkspace from "../components/network/NetworkWorkspace";
import { type NetworkMode, type PlaceMeta } from "../components/network/types";
import OrdenesPanel from "../components/operations/OrdenesPanel";
import ContabilidadModule from "../components/finance/ContabilidadModule";
import SoportePanel from "../components/operations/SoportePanel";
import TicketsPanel from "../components/operations/TicketsPanel";
import UsuariosPanel from "../components/platform/UsuariosPanel";
import CicaAssistant from "../components/channels/CicaAssistant";
import ClientesModule from "../components/crm/ClientesModule";
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
  setAssetParent,
  coverageIsochrones,
  getAssetIsochrone,
  updateInfraFiber,
  deleteInfraFiber,
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

type LayerKey = "barrios" | "cobertura" | "fibra" | "nodos" | "clientes";

export default function Page() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [stats, setStats] = useState<any | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [section, setSection] = useState<Section>("dashboard");
  const [networkMode, setNetworkMode] = useState<NetworkMode>("design");
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
  // Modo "Conectar postes": clic en poste tras poste crea tramos (A→B, B→C…).
  const [chaining, setChaining] = useState(false);
  const [chainFrom, setChainFrom] = useState<{ id: string; lng: number; lat: number; nombre: string } | null>(null);
  // Id del activo al que hizo snap cada vértice (para conectar la fibra a la topología).
  const [routeSnaps, setRouteSnaps] = useState<(string | null)[]>([]);
  // Modo "colocar activo": el siguiente clic en el mapa ubica un activo de este tipo.
  const [placeTipo, setPlaceTipo] = useState<string | null>(null);
  // Si está definido, el activo colocado se ancla a este padre (construcción jerárquica).
  const [placeParentId, setPlaceParentId] = useState<string | null>(null);
  // Datos (nombre/dirección/…) que el operador escribió para el activo a colocar.
  const [placeMeta, setPlaceMeta] = useState<PlaceMeta | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [ipLoc, setIpLoc] = useState<IpLocation | null>(null);
  // Modo construcción / simulador de venta
  const [buildMode, setBuildMode] = useState(false);
  const [buildResult, setBuildResult] = useState<ConstructionResult | null>(null);
  // Mapa de calor de densidad de clientes (modo Cobertura).
  const [heatmapOn, setHeatmapOn] = useState(true);
  // Polígono de alcance de tendido (Isochrone) de la NAP seleccionada en Cobertura.
  const [reachArea, setReachArea] = useState<{ type: "FeatureCollection"; features: any[] } | null>(null);
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

  // Cierre de sesión por INACTIVIDAD: tras 30 min sin actividad del usuario
  // (mouse/teclado/scroll/touch) se cierra la sesión. Cualquier interacción
  // reinicia el contador, así que mientras se trabaja la sesión nunca cae.
  useEffect(() => {
    if (!user) return;
    const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutos
    let timer: ReturnType<typeof setTimeout>;
    const cerrarPorInactividad = () => {
      socketRef.current?.disconnect();
      clearSession();
      router.replace("/login");
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(cerrarPorInactividad, INACTIVITY_MS);
    };
    const eventos: (keyof WindowEventMap)[] = [
      "mousemove", "mousedown", "keydown", "scroll", "touchstart", "click",
    ];
    eventos.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset(); // arranca el contador
    return () => {
      clearTimeout(timer);
      eventos.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, router]);

  // Cobertura: al entrar al modo, dibuja AUTOMÁTICAMENTE el alcance (150 m por
  // calle) de TODAS las NAP. Se refresca si cambia el número de NAP.
  useEffect(() => {
    if (section === "red" && networkMode === "coverage") {
      coverageIsochrones(150).then((r) => setReachArea(r.isochrones)).catch(() => {});
    } else {
      setReachArea(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, networkMode, naps.length]);

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

  // Sondeo de punto en modo Diseño: solo dirección (sin verificación comercial).
  function probePoint(lng: number, lat: number) {
    setFocusPoint(null);
    setCoverage(null);
    setPin({ lng, lat });
    setPinAddress(null);
    reverseGeocode(lat, lng).then((r) => setPinAddress(r.direccion)).catch(() => {});
  }

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
    setNetworkMode("operations");
    setDrawing(false); setBuildMode(false); setBuildResult(null);
    setRouting(false); setRoutePoints([]); setRouteSnaps([]); setPlaceTipo(null);
    setCoverage(null); setPin(null); setPinAddress(null);
    setFocusPoint({ lng, lat, color: "#22E0A1" });
  }

  // Navega al módulo de Red en un modo concreto (desde el Dashboard).
  function goNetwork(mode: NetworkMode) {
    setSection("red");
    setNetworkMode(mode);
  }

  // Cambia de modo dentro de Red; al salir de Cobertura limpia el alcance dibujado.
  function changeNetworkMode(mode: NetworkMode) {
    setNetworkMode(mode);
    if (mode !== "coverage") setReachArea(null);
    if (mode !== "design") { setChaining(false); setChainFrom(null); }
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

  // Guarda el trazado reeditado de un tramo de fibra (arrastre de vértices en el mapa).
  async function saveFiber(
    id: string,
    trazado: [number, number][],
    ends: { origenId?: string | null; destinoId?: string | null },
  ) {
    try {
      await updateInfraFiber(id, { trazado, ...ends });
      await refreshInfra();
    } catch (e: any) { setError(e.message); }
  }

  // Elimina por completo un tramo de fibra (desde la barra de edición del mapa).
  async function removeFiber(id: string) {
    try {
      await deleteInfraFiber(id);
      await refreshInfra();
    } catch (e: any) { setError(e.message); }
  }

  // Dibuja el alcance de tendido (Isochrone) de UNA NAP al pulsar ◎ en Cobertura.
  async function showReach(napId: string, metros?: number) {
    try {
      const r = await getAssetIsochrone(napId, metros);
      setReachArea(r.isochrone);
    } catch (e: any) { setError(e.message); }
  }
  function refreshCliStats() { clientesStats().then(setCliStats).catch(() => {}); ticketStats().then(setTickStats).catch(() => {}); }

  // ---- Dibujo de zona (comercial → modo Cobertura) ----
  function startDraw() { setSection("red"); setNetworkMode("coverage"); setDrawing(true); setDrawPoints([]); setFocusPoint(null); setCoverage(null); }
  function cancelDraw() { setDrawing(false); setDrawPoints([]); }
  function undoPoint() { setDrawPoints((pts) => pts.slice(0, -1)); }
  async function saveZone(nombre: string) {
    if (drawPoints.length < 3) return;
    try { await createZone(nombre, drawPoints); setDrawing(false); setDrawPoints([]); await refreshBundle(); }
    catch (e: any) { setError(e.message); }
  }
  function onMapClickRouter(lng: number, lat: number, snappedId?: string | null) {
    if (chaining) { chainClick(lng, lat, snappedId ?? null); return; }
    if (drawing) { setDrawPoints((pts) => [...pts, [lng, lat]]); return; }
    if (routing) { setRoutePoints((pts) => [...pts, [lng, lat]]); setRouteSnaps((s) => [...s, snappedId ?? null]); return; }
    if (placeTipo) { placeAssetAt(lng, lat, placeTipo); return; }
    // En Diseño, un clic en vacío sondea la dirección del punto (sin cobertura).
    if (networkMode === "design") { probePoint(lng, lat); return; }
    // En Cobertura con simulador de venta activo, evalúa la construcción.
    if (networkMode === "coverage" && buildMode) { runBuild(lng, lat); return; }
    // Operación / Cobertura: verifica cobertura en el punto.
    placePin(lng, lat);
  }

  // ---- Trazado de fibra poste a poste ----
  function startRoute() {
    setSection("red"); setNetworkMode("design");
    setRouting(true); setRoutePoints([]); setRouteSnaps([]);
    setDrawing(false); setPlaceTipo(null);
    setBuildMode(false); setBuildResult(null);
    setFocusPoint(null); setCoverage(null); setPin(null);
  }
  function undoRoutePoint() { setRoutePoints((pts) => pts.slice(0, -1)); setRouteSnaps((s) => s.slice(0, -1)); }
  function cancelRoute() { setRouting(false); setRoutePoints([]); setRouteSnaps([]); }

  // ---- Conectar postes: clic poste A → clic poste B crea el tramo A-B, y sigue
  // encadenando (B→C, C→D…). No toca los tramos ya guardados. Es el flujo simple
  // de tendido pole-a-pole.
  function startChain() {
    setSection("red"); setNetworkMode("design");
    setChaining(true); setChainFrom(null);
    setRouting(false); setRoutePoints([]); setRouteSnaps([]);
    setDrawing(false); setPlaceTipo(null); setBuildMode(false); setBuildResult(null);
    setFocusPoint(null); setCoverage(null); setPin(null); setInfraSelId(null);
  }
  function cancelChain() { setChaining(false); setChainFrom(null); setInfraSelId(null); }
  function startChainFrom(id: string, lng: number, lat: number, nombre: string) {
    startChain();
    setChainFrom({ id, lng, lat, nombre });
    setInfraSelId(id);
  }
  async function chainClick(lng: number, lat: number, snappedId: string | null) {
    if (!snappedId) { setError("Conectar postes: haz clic justo sobre un poste o NAP."); return; }
    setError(null);
    const feat = (infra?.assets.features as any[] | undefined)?.find((f) => f.properties.id === snappedId);
    const nombre = feat?.properties?.nombre ?? snappedId;
    if (!chainFrom) { setChainFrom({ id: snappedId, lng, lat, nombre }); setInfraSelId(snappedId); return; }
    if (chainFrom.id === snappedId) return; // mismo poste: ignora
    try {
      await createInfraFiber({ origenId: chainFrom.id, destinoId: snappedId });
      await refreshInfra();
      setChainFrom({ id: snappedId, lng, lat, nombre }); // continúa desde el destino
      setInfraSelId(snappedId);
    } catch (e: any) { setError(e.message); }
  }
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
  function startPlace(tipo: string, meta?: PlaceMeta) {
    setSection("red"); setNetworkMode("design");
    setPlaceTipo(tipo);
    setPlaceParentId(null);
    setPlaceMeta(meta ?? null);
    setRouting(false); setRoutePoints([]); setDrawing(false);
    setBuildMode(false); setBuildResult(null);
    setFocusPoint(null); setCoverage(null); setPin(null);
  }
  // Coloca un activo y lo ancla a un padre con el siguiente clic (jerarquía).
  function startPlaceChild(tipo: string, parentId: string) {
    startPlace(tipo);
    setPlaceParentId(parentId);
  }
  function stopPlace() { setPlaceTipo(null); setPlaceParentId(null); setPlaceMeta(null); }
  async function placeAssetAt(lng: number, lat: number, tipo: string) {
    if (placeBusy) return;
    setPlaceBusy(true);
    try {
      const child = await createInfraAsset({
        tipo, lng, lat,
        // Nombre y dirección los escribe el operador (no se geocodifica): el punto
        // es EXACTAMENTE donde hizo clic, y la dirección queda como etiqueta.
        nombre: placeMeta?.nombre,
        direccion: placeMeta?.direccion,
        marca: placeMeta?.marca,
        modelo: placeMeta?.modelo,
        serie: placeMeta?.serie,
        planMensual: placeMeta?.planMensual,
        puertosTotal: placeMeta?.puertosTotal ?? (tipo === "NAP" ? 16 : tipo === "Splitter" ? 8 : undefined),
        puertosUsados: placeMeta?.puertosUsados ?? (tipo === "NAP" || tipo === "Splitter" ? 0 : undefined),
      });
      if (placeParentId) {
        // Construcción jerárquica: ancla al padre, colocación única y deja el
        // hijo seleccionado para encadenar (NAP → Splitter → …).
        await setAssetParent(child.id, placeParentId);
        setPlaceParentId(null);
        setPlaceTipo(null);
        setInfraSelId(child.id);
      } else if (placeMeta) {
        // Colocación con datos propios = una sola pieza: termina y la selecciona.
        setPlaceTipo(null);
        setPlaceMeta(null);
        setInfraSelId(child.id);
      }
      await refreshInfra(); // el nuevo activo aparece donde hiciste clic.
    } catch (e: any) { setError(e.message); }
    finally { setPlaceBusy(false); }
  }

  function changeSection(s: Section) {
    setSection(s);
    setFocusPoint(null);
    // Al salir del módulo de Red se cancelan todas las herramientas de edición.
    if (s !== "red" && drawing) cancelDraw();
    if (s !== "red" && buildMode) { setBuildMode(false); setBuildResult(null); }
    if (s !== "red") { setRouting(false); setRoutePoints([]); setRouteSnaps([]); setPlaceTipo(null); }
    if (s !== "red") { setChaining(false); setChainFrom(null); }
    if (s !== "red") setReachArea(null);
  }
  function logout() { socketRef.current?.disconnect(); clearSession(); router.replace("/login"); }

  const canEdit = user?.role === "admin" || user?.role === "operador";
  const napOptions = useMemo(
    () => (infra?.assets.features || [])
      .filter((f: any) => f.properties.tipo === "NAP" || f.properties.tipo === "CTO")
      .map((f: any) => ({ id: f.properties.id, nombre: f.properties.nombre })),
    [infra],
  );

  const isMapSection = section === "red";

  return (
    <AppShell section={section} onSection={changeSection} user={user} onLogout={logout} live={live} ipLoc={ipLoc} badges={{ soporte: soportePend, tickets: (tickStats?.porEstado.abierto ?? 0) + (tickStats?.porEstado.en_proceso ?? 0) }}>
      {/* ===== Dashboard ===== */}
      {section === "dashboard" && (
        <div className="h-full overflow-y-auto p-6">
          <Dashboard cli={cliStats} infra={infra} naps={naps} onGo={changeSection} onGoNetwork={goNetwork} tick={tickStats} />
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

      {/* ===== Módulo de Red (Diseño · Operación · Cobertura) ===== */}
      {isMapSection && (
        data ? (
          <NetworkWorkspace
            mode={networkMode} onMode={changeNetworkMode} canEdit={!!canEdit}
            data={data} infra={infra} naps={naps} zones={zones} cli={cliStats}
            visibility={visibility} onToggle={toggle}
            selectedNode={selectedNode} onNodeSelect={setSelectedNode}
            infraSelId={infraSelId} onInfraSelect={setInfraSelId}
            coverage={coverage} checking={checking} pin={pin} pinAddress={pinAddress} pinColor={pinColor} focusPoint={focusPoint}
            onCheckAddress={onCheckAddress} onPinMove={placePin} onProbe={probePoint} onFocus={focusOn} onMapClick={onMapClickRouter}
            drawing={drawing} drawPoints={drawPoints}
            onStartDraw={startDraw} onUndoPoint={undoPoint} onCancelDraw={cancelDraw} onSaveZone={saveZone}
            routing={routing} routePoints={routePoints}
            onStartRoute={startRoute} onUndoRoutePoint={undoRoutePoint} onCancelRoute={cancelRoute} onFinishRoute={finishRoute}
            placeTipo={placeTipo} onStartPlace={startPlace} onStopPlace={stopPlace} onShortcut={onEditorShortcut} onPlaceChild={startPlaceChild}
            buildMode={buildMode} buildResult={buildResult} onToggleBuild={toggleBuildMode}
            heatmapOn={heatmapOn} onToggleHeatmap={() => setHeatmapOn((v) => !v)}
            reachArea={reachArea} onShowReach={showReach}
            onInfraChanged={refreshInfra} onBundleChanged={refreshBundle}
            onSaveFiber={saveFiber} onDeleteFiber={removeFiber}
            chaining={chaining} chainFromName={chainFrom?.nombre ?? null}
            onStartChain={startChain} onCancelChain={cancelChain} onChainFrom={startChainFrom}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-cica-muted">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
              <span className="text-sm">{error ? `Error: ${error}` : "Cargando mapa…"}</span>
            </div>
          </div>
        )
      )}
      {/* Asistente virtual flotante (disponible en todo el panel) */}
      <CicaAssistant />
    </AppShell>
  );
}

/* ===================== Dashboard ===================== */

function Dashboard({
  cli, infra, naps, onGo, onGoNetwork, tick,
}: {
  cli: ClienteStats | null;
  infra: InfraBundle | null;
  naps: NapRecord[];
  onGo: (s: Section) => void;
  onGoNetwork: (mode: NetworkMode) => void;
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
        <Card label="Equipos de red" value={String(infra?.stats.activos ?? 0)} sub="activos" accent="text-cica-gold" onClick={() => onGoNetwork("design")} />
        <Card label="NAP / CTO" value={String((infra?.assets.features || []).filter((f: any) => f.properties.tipo === "NAP" || f.properties.tipo === "CTO").length)} sub="puntos de acceso" accent="text-status-ftth" onClick={() => onGoNetwork("design")} />
        <Card label="Fibra tendida" value={`${km} km`} sub={`${infra?.stats.fibras ?? 0} tramos`} accent="text-cica-glow" onClick={() => onGoNetwork("design")} />
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
