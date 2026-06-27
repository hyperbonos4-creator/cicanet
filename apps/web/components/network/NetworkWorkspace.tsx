"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { MapData } from "./CoverageMap";
import NetworkModeSwitch from "./NetworkModeSwitch";
import OperacionPanel from "./OperacionPanel";
import InfraPanel from "./InfraPanel";
import AssetInspector from "./design/AssetInspector";
import CoveragePanel from "./coverage/CoveragePanel";
import ClientesPanel from "../crm/ClientesPanel";
import type { NetworkMode, LayerKey, PlaceMeta } from "./types";
import type {
  CoverageResult,
  InfraBundle,
  NapRecord,
  ZoneRecord,
  ConstructionResult,
  ClienteStats,
} from "../../lib/api";

const CoverageMap = dynamic(() => import("./CoverageMap"), { ssr: false });
const InfraMap = dynamic(() => import("./InfraMap"), { ssr: false });

export interface NetworkWorkspaceProps {
  mode: NetworkMode;
  onMode: (m: NetworkMode) => void;
  canEdit: boolean;

  data: MapData;
  infra: InfraBundle | null;
  naps: NapRecord[];
  zones: ZoneRecord[];
  /** Estadísticas comerciales para el panel analítico de Cobertura. */
  cli: ClienteStats | null;

  // capas (operación)
  visibility: Record<LayerKey, boolean>;
  onToggle: (k: LayerKey) => void;

  // selección
  selectedNode: Record<string, any> | null;
  onNodeSelect: (n: Record<string, any> | null) => void;
  infraSelId: string | null;
  onInfraSelect: (id: string | null) => void;

  // cobertura / pin
  coverage: CoverageResult | null;
  checking: boolean;
  pin: { lng: number; lat: number } | null;
  pinAddress: string | null;
  pinColor: string;
  focusPoint: { lng: number; lat: number; color?: string } | null;
  onCheckAddress: (lng: number, lat: number) => void;
  onPinMove: (lng: number, lat: number) => void;
  /** Sondeo de dirección al clic/arrastre en modo Diseño (sin cobertura). */
  onProbe: (lng: number, lat: number) => void;
  onFocus: (lng: number, lat: number, color?: string) => void;
  onMapClick: (lng: number, lat: number, snappedId?: string | null) => void;

  // edición de zonas (comercial)
  drawing: boolean;
  drawPoints: [number, number][];
  onStartDraw: () => void;
  onUndoPoint: () => void;
  onCancelDraw: () => void;
  onSaveZone: (nombre: string) => void;

  // trazado de fibra (diseño)
  routing: boolean;
  routePoints: [number, number][];
  onStartRoute: () => void;
  onUndoRoutePoint: () => void;
  onCancelRoute: () => void;
  onFinishRoute: (opts: { nombre?: string; tipoFibra?: "monomodo" | "multimodo"; hilos?: number }) => void;

  // colocar activos (diseño)
  placeTipo: string | null;
  onStartPlace: (tipo: string, meta?: PlaceMeta) => void;
  onStopPlace: () => void;
  onShortcut: (action: "poste" | "nap" | "empalme" | "splitter" | "cable" | "cancel" | "undo") => void;
  /** Coloca un hijo anclado al activo seleccionado con el siguiente clic. */
  onPlaceChild: (tipo: string, parentId: string) => void;

  // simulador de venta (comercial)
  buildMode: boolean;
  buildResult: ConstructionResult | null;
  onToggleBuild: () => void;

  /** Mapa de calor de densidad (modo Cobertura). */
  heatmapOn: boolean;
  onToggleHeatmap: () => void;

  /** Alcance de tendido (Isochrone) de la NAP seleccionada en Cobertura. */
  reachArea: { type: "FeatureCollection"; features: any[] } | null;
  onShowReach: (napId: string, metros?: number) => void;

  onInfraChanged: () => void;
  onBundleChanged: () => void;

  /** Guarda el trazado reeditado de un tramo de fibra (arrastre de vértices). */
  onSaveFiber: (
    id: string,
    trazado: [number, number][],
    ends: { origenId?: string | null; destinoId?: string | null },
  ) => Promise<void> | void;
  /** Elimina por completo un tramo de fibra desde la barra de edición. */
  onDeleteFiber: (id: string) => Promise<void> | void;

  /** Conectar postes: crea tramos pole-a-pole con clics consecutivos. */
  chaining: boolean;
  chainFromName: string | null;
  onStartChain: () => void;
  onCancelChain: () => void;
  onChainFrom: (id: string, lng: number, lat: number, nombre: string) => void;
}

/**
 * Módulo de Red unificado: un solo lienzo con tres MODOS que separan la intención
 * del usuario (Diseño / Operación / Cobertura). Reemplaza los dos apartados
 * solapados "Editor de Red" y "Mapa". Toda la lógica de estado vive en el
 * orquestador (page.tsx); aquí solo se decide QUÉ se muestra en cada modo.
 */
export default function NetworkWorkspace(p: NetworkWorkspaceProps) {
  const isDesign = p.mode === "design";
  // Cascada de afectados al simular una falla (estado local: el mapa y el
  // inspector viven aquí, no hace falta subirlo al orquestador page.tsx).
  const [affectedIds, setAffectedIds] = useState<string[]>([]);
  // Timeline de actividad de red (registro de la sesión: simulaciones, etc.).
  const [events, setEvents] = useState<NetEvent[]>([]);
  const pushEvent = useCallback((e: Omit<NetEvent, "id" | "ts">) => {
    setEvents((prev) => [{ ...e, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() }, ...prev].slice(0, 40));
  }, []);

  // Resuelve el nombre legible de un activo desde el bundle.
  const assetName = useCallback(
    (id: string) => (p.infra?.assets.features as any[])?.find((f) => f.properties.id === id)?.properties?.nombre ?? id,
    [p.infra],
  );

  const onSimEvent = useCallback(
    (imp: import("../../lib/api").FailureImpact) => {
      const sev = SEVERITY_COLOR[imp.severidad] ?? "#FFB02E";
      pushEvent({
        kind: "sim",
        color: sev,
        title: `Simulación de falla · ${assetName(imp.nodoCaido)}`,
        detail: `${imp.clientesAfectados.length} cliente(s) · ${imp.napsAfectadas} NAP · ${COP.format(imp.ingresosEnRiesgo)} en riesgo · severidad ${imp.severidad}`,
      });
    },
    [assetName, pushEvent],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Selector de modo: hace explícita la intención del módulo. */}
      <div className="shrink-0 border-b border-cica-border/70 bg-cica-navy/50 px-4 py-2.5">
        <NetworkModeSwitch mode={p.mode} onChange={p.onMode} canEdit={p.canEdit} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-[45%] w-full shrink-0 overflow-y-auto border-b border-cica-border/70 bg-cica-navy/40 p-4 md:max-h-none md:w-[336px] md:border-b-0 md:border-r">
          {p.mode === "design" && (
            <div className="flex flex-col gap-3">
              {/* Conectar postes: el flujo simple de tendido pole-a-pole. */}
              <div className={`rounded-xl border p-3 ${p.chaining ? "border-cica-glow/60 bg-cica-glow/10" : "border-cica-border/70 bg-cica-navy/40"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-cica-muted">Conectar postes</div>
                  {p.chaining ? (
                    <button onClick={p.onCancelChain} className="rounded-md border border-white/15 px-2 py-1 text-[10px] font-semibold text-cica-silver hover:bg-white/10">Terminar</button>
                  ) : (
                    <button onClick={p.onStartChain} disabled={!p.canEdit} className="rounded-md bg-cica-gold px-2.5 py-1 text-[10px] font-bold text-black hover:opacity-90 disabled:opacity-40">🔗 Iniciar</button>
                  )}
                </div>
                {p.chaining ? (
                  <div className="mt-1 text-[11px] text-cica-silver">
                    {p.chainFromName
                      ? <>Desde <strong className="text-cica-glow">{p.chainFromName}</strong> · haz clic en el siguiente poste para crear el tramo. Sigue encadenando.</>
                      : "Haz clic en el primer poste para empezar."}
                  </div>
                ) : (
                  <div className="mt-1 text-[10px] text-cica-muted">Clic en un poste y luego en el siguiente: crea el tramo y continúa, sin tocar los ya guardados.</div>
                )}
              </div>
              {/* Sondeo de dirección del punto activo (clic en el mapa). */}
              {p.pin && (
                <div className="glass-soft animate-fadeUp px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wider text-cica-muted">Punto en el mapa</span>
                    <span className="font-mono text-[10px] text-cica-steelLight">{p.pin.lat.toFixed(5)}, {p.pin.lng.toFixed(5)}</span>
                  </div>
                  <div className="mt-0.5 text-cica-silver">{p.pinAddress ?? "Resolviendo dirección…"}</div>
                  {p.placeTipo && <div className="mt-1 text-[10px] text-cica-gold">Haz clic en el mapa para ubicar: {p.placeTipo}</div>}
                </div>
              )}
              {/* Inspector contextual del activo seleccionado (Packet Tracer).
                  En md+ se muestra en el RAIL DERECHO (ver más abajo); en móvil
                  se muestra aquí, en la columna, donde sí hay espacio vertical. */}
              <div className="md:hidden">
                <AssetInspector
                  assetId={p.infraSelId}
                  infra={p.infra}
                  canEdit={p.canEdit}
                  onInfraChanged={p.onInfraChanged}
                  onFocus={p.onFocus}
                  onClear={() => p.onInfraSelect(null)}
                  onPlaceChild={p.onPlaceChild}
                  onSelect={(id) => p.onInfraSelect(id)}
                  onChainFrom={p.onChainFrom}
                  onImpact={setAffectedIds}
                  onSimEvent={onSimEvent}
                />
              </div>
              <InfraPanel
                tabs={["activos", "trazar", "topologia"]}
                naps={p.naps} zones={p.zones} canEdit={p.canEdit} onFocus={p.onFocus} onChanged={p.onBundleChanged}
                drawing={p.drawing} drawPointsCount={p.drawPoints.length}
                onStartDraw={p.onStartDraw} onUndoPoint={p.onUndoPoint} onCancelDraw={p.onCancelDraw} onSaveZone={p.onSaveZone}
                infra={p.infra} onInfraChanged={p.onInfraChanged}
                buildMode={p.buildMode} buildResult={p.buildResult} onToggleBuild={p.onToggleBuild}
                routing={p.routing} routePointsCount={p.routePoints.length}
                onStartRoute={p.onStartRoute} onUndoRoutePoint={p.onUndoRoutePoint} onCancelRoute={p.onCancelRoute} onFinishRoute={p.onFinishRoute}
                placeTipo={p.placeTipo} onStartPlace={p.onStartPlace} onStopPlace={p.onStopPlace}
              />
            </div>
          )}

          {p.mode === "operations" && (
            <OperacionPanel infra={p.infra} visibility={p.visibility} onToggle={p.onToggle} coverage={p.coverage} checking={p.checking} onFocus={p.onFocus} />
          )}

          {p.mode === "coverage" && (
            <div className="flex flex-col gap-3">
              <ClientesPanel onCheckAddress={p.onCheckAddress} coverage={p.coverage} checking={p.checking} pinAddress={p.pinAddress} pin={p.pin} />
              <CoveragePanel naps={p.naps} zones={p.zones} cli={p.cli} onFocus={p.onFocus} heatmapOn={p.heatmapOn} onToggleHeatmap={p.onToggleHeatmap} onShowReach={p.onShowReach} />
              <InfraPanel
                tabs={["cobertura", "construccion"]}
                showKpis={false}
                naps={p.naps} zones={p.zones} canEdit={p.canEdit} onFocus={p.onFocus} onChanged={p.onBundleChanged}
                drawing={p.drawing} drawPointsCount={p.drawPoints.length}
                onStartDraw={p.onStartDraw} onUndoPoint={p.onUndoPoint} onCancelDraw={p.onCancelDraw} onSaveZone={p.onSaveZone}
                infra={p.infra} onInfraChanged={p.onInfraChanged}
                buildMode={p.buildMode} buildResult={p.buildResult} onToggleBuild={p.onToggleBuild}
                routing={p.routing} routePointsCount={p.routePoints.length}
                onStartRoute={p.onStartRoute} onUndoRoutePoint={p.onUndoRoutePoint} onCancelRoute={p.onCancelRoute} onFinishRoute={p.onFinishRoute}
                placeTipo={p.placeTipo} onStartPlace={p.onStartPlace} onStopPlace={p.onStopPlace}
              />
            </div>
          )}
        </aside>

        <div className="relative min-w-0 flex-1">
          {isDesign ? (
            <InfraMap
              assets={p.infra?.assets ?? { type: "FeatureCollection", features: [] }}
              fiber={p.infra?.fiber ?? { type: "FeatureCollection", features: [] }}
              barrios={p.data.comuna1}
              zones={p.data.zones}
              onSelect={(f: any) => p.onInfraSelect(f.id)}
              selectedId={p.infraSelId}
              highlightIds={affectedIds}
              focusPoint={p.focusPoint}
              onMapClick={p.onMapClick}
              drawing={p.drawing}
              drawPoints={p.drawPoints}
              routing={p.routing}
              routePoints={p.routePoints}
              placing={!!p.placeTipo}
              onShortcut={p.onShortcut}
              draggablePin={p.pin}
              pinColor={p.pinColor}
              onPinMove={p.onProbe}
              canEdit={p.canEdit}
              onSaveFiber={p.onSaveFiber}
              onDeleteFiber={p.onDeleteFiber}
              chaining={p.chaining}
            />
          ) : (
            <CoverageMap
              data={p.data} visibility={p.visibility} onNodeSelect={p.onNodeSelect}
              onMapClick={p.onMapClick}
              focusPoint={p.focusPoint} drawing={p.drawing} drawPoints={p.drawPoints}
              draggablePin={p.pin} pinColor={p.pinColor} onPinMove={p.onPinMove}
              infra={p.infra ? { assets: p.infra.assets, fiber: p.infra.fiber } : null}
              showOnlyInfra={true}
              heatmap={p.mode === "coverage" && p.heatmapOn}
              reachArea={p.mode === "coverage" ? p.reachArea : null}
            />
          )}

          {/* Leyenda según intención del modo */}
          <div className="glass-soft absolute bottom-5 left-5 z-10 px-4 py-3">
            {isDesign ? (
              <>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Infraestructura</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-cica-silver">
                  <LegendDot color="#22D3EE" label="POP / Central" />
                  <LegendDot color="#3B82F6" label="OLT" />
                  <LegendDot color="#22E0A1" label="NAP / Caja" />
                  <LegendDot color="#38BDF8" label="Splitter" />
                  <LegendDot color="#A3E635" label="Empalme" />
                  <LegendDot color="#3B82F6" label="Fibra" />
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
                {p.mode === "coverage" && (
                  <div className="mt-2 border-t border-cica-border/50 pt-2">
                    <div className="mb-1 text-[10px] font-semibold text-cica-muted">Densidad de clientes</div>
                    <div className="h-2 w-full rounded-full" style={{ background: "linear-gradient(90deg,#0EA5E9,#22E0A1,#FFB02E,#FF7A1A,#FF4D6D)" }} />
                    <div className="mt-0.5 flex justify-between text-[9px] text-cica-muted"><span>baja</span><span>alta</span></div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Detalle de nodo (modo Operación: monitoreo en vivo) */}
          {p.mode === "operations" && p.selectedNode && (
            <div className="glass absolute bottom-5 right-5 z-10 w-[260px] animate-fadeUp p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-extrabold text-white">{p.selectedNode.nombre}</div>
                  <div className="text-[11px] text-cica-muted">
                    {p.selectedNode.tipo} · {p.selectedNode.estado === "online" ? <span className="text-status-ftth">online</span> : <span className="text-status-parcial">degradado</span>}
                  </div>
                </div>
                <button onClick={() => p.onNodeSelect(null)} className="text-cica-muted hover:text-white">✕</button>
              </div>
              {p.selectedNode.direccion && <div className="mt-1 text-[10px] text-cica-muted line-clamp-2">{p.selectedNode.direccion}</div>}
              {"puertos_total" in p.selectedNode && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-cica-muted">
                    <span>Ocupación de puertos</span>
                    <span className="font-semibold text-cica-silver">{p.selectedNode.puertos_usados}/{p.selectedNode.puertos_total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-cica-border">
                    <div className="h-full rounded-full bg-gradient-to-r from-cica-amber to-cica-gold" style={{ width: `${(p.selectedNode.puertos_usados / p.selectedNode.puertos_total) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Rail derecho: Inspector contextual (Packet Tracer) ──
            Separa "inspeccionar lo seleccionado" de "construir/inventario"
            (columna izquierda) y del lienzo (centro). Solo en Diseño y cuando
            hay un activo seleccionado; en móvil el inspector vive en la columna. */}
        {isDesign && p.infraSelId && (
          <aside className="hidden shrink-0 overflow-y-auto border-l border-cica-border/70 bg-cica-navy/40 p-4 md:block md:w-[360px]">
            <AssetInspector
              assetId={p.infraSelId}
              infra={p.infra}
              canEdit={p.canEdit}
              onInfraChanged={p.onInfraChanged}
              onFocus={p.onFocus}
              onClear={() => p.onInfraSelect(null)}
              onPlaceChild={p.onPlaceChild}
              onSelect={(id) => p.onInfraSelect(id)}
              onChainFrom={p.onChainFrom}
              onImpact={setAffectedIds}
              onSimEvent={onSimEvent}
            />
          </aside>
        )}
      </div>

      {/* ── Dock inferior: timeline de actividad de red (Diseño) ── */}
      {isDesign && <TimelineDock events={events} onClear={() => setEvents([])} />}
    </div>
  );
}

type NetEvent = {
  id: string;
  ts: number;
  kind: "sim" | "info";
  title: string;
  detail?: string;
  color?: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  baja: "#22E0A1", media: "#FFB02E", alta: "#FF8A3D", critica: "#FF4D6D",
};
const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** Dock inferior colapsable con el registro de eventos de la sesión. */
function TimelineDock({ events, onClear }: { events: NetEvent[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const last = events[0];
  return (
    <div className="shrink-0 border-t border-cica-border/70 bg-cica-navy/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cica-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${events.length ? "bg-cica-gold" : "bg-cica-border"}`} />
          Actividad de red
        </span>
        <span className="rounded-full bg-cica-border/50 px-2 py-0.5 text-[10px] font-semibold text-cica-silver">{events.length}</span>
        {last && !open && (
          <span className="truncate text-[11px] text-cica-muted">
            <span style={{ color: last.color || "#E6EDF7" }}>●</span> {last.title}
          </span>
        )}
        <span className="ml-auto text-[11px] text-cica-muted">{open ? "▾ Ocultar" : "▸ Ver registro"}</span>
      </button>

      {open && (
        <div className="max-h-44 overflow-y-auto border-t border-cica-border/50 px-4 py-2">
          {events.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-cica-muted">
              Sin actividad todavía. Simula la caída de un nodo (pestaña Ingeniería) para registrar su impacto aquí.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-end">
                <button onClick={onClear} className="text-[10px] text-cica-muted hover:text-status-sin">Limpiar registro</button>
              </div>
              {events.map((e) => (
                <div key={e.id} className="flex items-start gap-2.5 rounded-lg border border-cica-border/40 bg-cica-black/30 px-3 py-1.5">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: e.color || "#8B96AC" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[11px] font-semibold text-cica-silver">{e.title}</span>
                      <span className="ml-auto shrink-0 font-mono text-[9px] text-cica-muted">
                        {new Date(e.ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </div>
                    {e.detail && <div className="text-[10px] text-cica-muted">{e.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
