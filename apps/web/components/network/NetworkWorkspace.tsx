"use client";

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

  onInfraChanged: () => void;
  onBundleChanged: () => void;
}

/**
 * Módulo de Red unificado: un solo lienzo con tres MODOS que separan la intención
 * del usuario (Diseño / Operación / Cobertura). Reemplaza los dos apartados
 * solapados "Editor de Red" y "Mapa". Toda la lógica de estado vive en el
 * orquestador (page.tsx); aquí solo se decide QUÉ se muestra en cada modo.
 */
export default function NetworkWorkspace(p: NetworkWorkspaceProps) {
  const isDesign = p.mode === "design";

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
              {/* Inspector contextual del activo seleccionado (Packet Tracer). */}
              <AssetInspector
                assetId={p.infraSelId}
                infra={p.infra}
                canEdit={p.canEdit}
                onInfraChanged={p.onInfraChanged}
                onFocus={p.onFocus}
                onClear={() => p.onInfraSelect(null)}
                onPlaceChild={p.onPlaceChild}
              />
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
            <OperacionPanel infra={p.infra} visibility={p.visibility} onToggle={p.onToggle} coverage={p.coverage} checking={p.checking} />
          )}

          {p.mode === "coverage" && (
            <div className="flex flex-col gap-3">
              <ClientesPanel onCheckAddress={p.onCheckAddress} coverage={p.coverage} checking={p.checking} pinAddress={p.pinAddress} pin={p.pin} />
              <CoveragePanel naps={p.naps} zones={p.zones} cli={p.cli} onFocus={p.onFocus} heatmapOn={p.heatmapOn} onToggleHeatmap={p.onToggleHeatmap} />
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
      </div>
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
