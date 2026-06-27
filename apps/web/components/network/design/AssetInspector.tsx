"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAssetPorts,
  generateAssetPorts,
  connectPort,
  disconnectPort,
  getAssetTrace,
  listClientes,
  deleteInfraAsset,
  updateInfraAsset,
  type InfraBundle,
  type PortsDetail,
  type InfraPort,
  type TraceResult,
  type Cliente,
} from "../../../lib/api";
import EngineInsights from "./EngineInsights";

// Tipos que portan puertos asignables.
const PORT_BEARING = new Set(["NAP", "CTO", "OLT", "Splitter"]);

// Jerarquía de construcción (Packet Tracer): qué hijos puede crear cada tipo.
// Refleja las reglas del dominio del backend (POP→OLT→NAP→Splitter→ONU/Cliente).
const CHILD_RULES: Record<string, { tipo: string; label: string }[]> = {
  Fibra: [
    { tipo: "NAP", label: "+ NAP" },
    { tipo: "Empalme", label: "+ Empalme" },
  ],
  POP: [{ tipo: "OLT", label: "+ OLT" }],
  OLT: [
    { tipo: "NAP", label: "+ NAP" },
    { tipo: "Splitter", label: "+ Splitter" },
  ],
  NAP: [{ tipo: "Splitter", label: "+ Splitter" }],
};

const TIPO_COLOR: Record<string, string> = {
  POP: "#22D3EE", OLT: "#3B82F6", NAP: "#22E0A1", CTO: "#22E0A1",
  Splitter: "#38BDF8", Cliente: "#38BDF8", Poste: "#D6A35C", Empalme: "#A3E635",
};
const dot = (t: string) => TIPO_COLOR[t] || "#8B96AC";
const ESTADO_COLOR: Record<string, string> = {
  libre: "#22E0A1", ocupado: "#FF4D6D", reservado: "#FFB02E", dañado: "#8B96AC",
};

type AssetFeature = {
  properties: { id: string; tipo: string; nombre: string; estado?: string; direccion?: string; padreId?: string | null };
  geometry: { coordinates: [number, number] };
};

/**
 * Inspector contextual del activo seleccionado (modo Diseño / Packet Tracer).
 * Según el TIPO del activo muestra acciones válidas: crear hijos jerárquicos,
 * generar/gestionar puertos y asignar servicios, y trazar la ruta óptica a la
 * raíz. Es la pieza que convierte el mapa en un constructor de red jerárquico.
 */
export default function AssetInspector({
  assetId,
  infra,
  canEdit,
  onInfraChanged,
  onFocus,
  onClear,
  onPlaceChild,
  onSelect,
  onChainFrom,
}: {
  assetId: string | null;
  infra: InfraBundle | null;
  canEdit: boolean;
  onInfraChanged: () => void;
  onFocus: (lng: number, lat: number, color?: string) => void;
  onClear: () => void;
  onPlaceChild: (tipo: string, parentId: string) => void;
  onSelect?: (id: string) => void;
  onChainFrom?: (id: string, lng: number, lat: number, nombre: string) => void;
}) {
  const [ports, setPorts] = useState<PortsDetail | null>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  // Renombrado inline y confirmación de borrado del activo.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  // Pestañas del inspector: separan resumen, conectividad e ingeniería para
  // evitar el "todo apilado" en una sola columna.
  const [tab, setTab] = useState<"resumen" | "puertos" | "ingenieria">("resumen");

  const assets = (infra?.assets.features as AssetFeature[]) || [];
  const asset = assets.find((a) => a.properties.id === assetId) || null;
  const tipo = asset?.properties.tipo ?? "";
  const parent = asset?.properties.padreId
    ? assets.find((a) => a.properties.id === asset.properties.padreId) || null
    : null;
  const children = assetId ? assets.filter((a) => a.properties.padreId === assetId) : [];
  const bearsPorts = PORT_BEARING.has(tipo);

  const reload = useCallback(async () => {
    if (!assetId) { setPorts(null); setTrace(null); return; }
    setErr(null);
    if (PORT_BEARING.has(tipo)) {
      try { setPorts(await getAssetPorts(assetId)); } catch (e: any) { setErr(e.message); }
    } else setPorts(null);
    try { setTrace(await getAssetTrace(assetId)); } catch { setTrace(null); }
  }, [assetId, tipo]);

  useEffect(() => { setAssignFor(null); setEditingName(false); setConfirmDel(false); setTab("resumen"); reload(); }, [reload]);

  if (!assetId || !asset) return null;

  const [lng, lat] = asset.geometry.coordinates;

  // Activos APILADOS en este mismo punto (p. ej. una NAP montada sobre un poste).
  // Permite ver y editar toda la estructura que comparte la coordenada, no solo
  // el que quedó arriba al hacer clic.
  const EPS = 0.00004; // ~4.5 m
  const coLocated = assets.filter(
    (a) =>
      a.properties.id !== assetId &&
      Math.abs(a.geometry.coordinates[0] - lng) < EPS &&
      Math.abs(a.geometry.coordinates[1] - lat) < EPS,
  );

  async function run(fn: () => Promise<any>) {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await fn(); onInfraChanged(); await reload(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // Renombra el activo (NAP, poste, etc.) y refresca el bundle.
  async function saveName() {
    const nombre = nameDraft.trim();
    if (!nombre || nombre === asset!.properties.nombre) { setEditingName(false); return; }
    await run(async () => { await updateInfraAsset(assetId!, { nombre }); setEditingName(false); });
  }

  // Elimina el activo y cierra el inspector (ya no existe en el mapa).
  async function eliminar() {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await deleteInfraAsset(assetId!); onInfraChanged(); onClear(); }
    catch (e: any) { setErr(e.message); setConfirmDel(false); }
    finally { setBusy(false); }
  }

  return (
    <div className="glass animate-fadeUp flex flex-col gap-3 p-4">
      {/* Cabecera */}
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: dot(tipo), boxShadow: `0 0 8px ${dot(tipo)}` }} />
          <div className="min-w-0">
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                disabled={busy}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                onBlur={saveName}
                className="w-full rounded-md border border-cica-gold/50 bg-cica-black/50 px-2 py-1 text-sm font-extrabold text-white outline-none"
              />
            ) : (
              <div className="truncate text-sm font-extrabold text-white">{asset.properties.nombre}</div>
            )}
            <div className="text-[11px] text-cica-muted">
              {tipo}{asset.properties.estado ? ` · ${asset.properties.estado}` : ""}
            </div>
            {asset.properties.direccion && <div className="mt-0.5 text-[10px] text-cica-muted line-clamp-2">{asset.properties.direccion}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && !editingName && (
            <button
              onClick={() => { setNameDraft(asset!.properties.nombre); setEditingName(true); }}
              className="text-cica-muted hover:text-cica-gold"
              title="Renombrar"
            >✎</button>
          )}
          {canEdit && (
            <button
              onClick={() => setConfirmDel(true)}
              disabled={busy}
              className="text-cica-muted hover:text-status-sin disabled:opacity-50"
              title="Eliminar activo"
            >🗑</button>
          )}
          <button onClick={onClear} className="text-cica-muted hover:text-white" title="Cerrar">✕</button>
        </div>
      </div>

      {/* Confirmación de borrado */}
      {confirmDel && (
        <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2">
          <p className="text-[11px] text-status-sin">¿Eliminar <strong>{asset.properties.nombre}</strong>? Se quitará del mapa y se liberarán sus puertos y conexiones.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={eliminar} disabled={busy} className="flex-1 rounded-md border border-status-sin/60 bg-status-sin/20 px-2 py-1 text-[11px] font-bold text-status-sin disabled:opacity-50">
              {busy ? "Eliminando…" : "Sí, eliminar"}
            </button>
            <button onClick={() => setConfirmDel(false)} disabled={busy} className="flex-1 rounded-md border border-cica-border/60 px-2 py-1 text-[11px] text-cica-silver">Cancelar</button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => onFocus(lng, lat, dot(tipo))} className="btn-cica-ghost flex-1 text-[11px]">Centrar en mapa</button>
      </div>

      {err && <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-[11px] text-status-sin">{err}</div>}

      {/* Pestañas: separan resumen, conectividad e ingeniería. */}
      <div className="flex gap-1 rounded-lg border border-cica-border/50 bg-cica-black/30 p-0.5">
        {([
          { key: "resumen", label: "Resumen" },
          ...(bearsPorts ? [{ key: "puertos", label: "Puertos" }] : []),
          { key: "ingenieria", label: "Ingeniería" },
        ] as { key: typeof tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
              tab === t.key ? "bg-cica-gold/15 text-cica-gold" : "text-cica-muted hover:text-cica-silver"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Pestaña Resumen ── */}
      {tab === "resumen" && (
        <div className="flex flex-col gap-3">
          {canEdit && onChainFrom && (
            <button
              onClick={() => onChainFrom(assetId!, lng, lat, asset!.properties.nombre)}
              className="rounded-lg border border-cica-glow/50 bg-cica-glow/10 px-3 py-1.5 text-[11px] font-semibold text-cica-glow hover:bg-cica-glow/20"
              title="Crear un tramo de fibra desde este punto al siguiente poste"
            >
              🔗 Iniciar tramo de fibra desde aquí
            </button>
          )}

          {/* Activos apilados en este mismo punto (NAP sobre poste, etc.) */}
          {coLocated.length > 0 && (
            <div className="rounded-lg border border-cica-glow/30 bg-cica-navy/30 p-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">
                También en este punto ({coLocated.length})
              </div>
              <div className="flex flex-col gap-1">
                {coLocated.map((a) => (
                  <button
                    key={a.properties.id}
                    onClick={() => onSelect?.(a.properties.id)}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-cica-border/40"
                    title="Editar este activo"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot(a.properties.tipo) }} />
                    <span className="truncate text-[11px] font-semibold text-cica-silver">{a.properties.nombre}</span>
                    <span className="ml-auto text-[9px] text-cica-muted">{a.properties.tipo}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-cica-muted">Toca uno para renombrarlo, editarlo o eliminarlo.</p>
            </div>
          )}

          {/* Cadena jerárquica (padre) */}
          {parent && (
            <button
              onClick={() => onFocus(parent.geometry.coordinates[0], parent.geometry.coordinates[1], dot(parent.properties.tipo))}
              className="flex items-center gap-2 rounded-lg border border-cica-border/60 bg-cica-panel/40 px-3 py-2 text-left hover:border-cica-gold/40"
            >
              <span className="text-[10px] text-cica-muted">▲ Depende de</span>
              <span className="h-2 w-2 rounded-full" style={{ background: dot(parent.properties.tipo) }} />
              <span className="truncate text-[11px] font-semibold text-cica-silver">{parent.properties.nombre}</span>
            </button>
          )}

          {/* Crear hijos (jerarquía) — se ubican con un clic en el mapa */}
          {canEdit && CHILD_RULES[tipo] && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Agregar a este nodo</div>
              <div className="flex flex-wrap gap-1.5">
                {CHILD_RULES[tipo].map((c) => (
                  <button key={c.tipo} disabled={busy} onClick={() => onPlaceChild(c.tipo, assetId!)} className="btn-cica-ghost text-[11px] disabled:opacity-50">
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-cica-muted">Luego haz clic en el mapa para ubicarlo.</p>
            </div>
          )}

          {/* Hijos directos */}
          {children.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Conectados ({children.length})</div>
              <div className="flex flex-col gap-1">
                {children.slice(0, 8).map((c) => (
                  <button
                    key={c.properties.id}
                    onClick={() => onFocus(c.geometry.coordinates[0], c.geometry.coordinates[1], dot(c.properties.tipo))}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-cica-border/30"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: dot(c.properties.tipo) }} />
                    <span className="truncate text-[11px] text-cica-silver">{c.properties.nombre}</span>
                    <span className="ml-auto text-[9px] text-cica-muted">{c.properties.tipo}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!parent && !children.length && !coLocated.length && !CHILD_RULES[tipo] && (
            <p className="text-[11px] text-cica-muted">Sin elementos conectados todavía.</p>
          )}
        </div>
      )}

      {/* ── Pestaña Puertos ── */}
      {tab === "puertos" && bearsPorts && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-cica-muted">Puertos</span>
            {ports && <span className="text-[10px] text-cica-muted">{ports.stats.libres} libres / {ports.stats.total}</span>}
          </div>

          {!ports || ports.puertos.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-cica-muted">Este nodo aún no tiene puertos.</p>
              {canEdit && (
                <div className="flex gap-1.5">
                  {[8, 16, 32].map((n) => (
                    <button key={n} disabled={busy} onClick={() => run(() => generateAssetPorts(assetId!, n))} className="btn-cica-ghost flex-1 text-[11px] disabled:opacity-50">
                      Generar {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {ports.puertos.map((pt) => (
                <PortChip key={pt.id} port={pt} canEdit={canEdit} busy={busy}
                  active={assignFor === pt.id}
                  onAssignStart={() => setAssignFor(pt.id)}
                  onDisconnect={() => run(() => disconnectPort(pt.id))}
                />
              ))}
            </div>
          )}

          {/* Panel de asignación de un puerto libre — selector real de cliente */}
          {assignFor && canEdit && (
            <div className="mt-2 rounded-lg border border-cica-border/60 bg-cica-panel/40 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-cica-silver">Asignar cliente al puerto</span>
                <button onClick={() => setAssignFor(null)} className="text-[11px] text-cica-muted hover:text-white">✕</button>
              </div>
              <ClientePicker
                busy={busy}
                onPick={(cli) => run(async () => { await connectPort(assignFor!, { servicioId: cli.id }); setAssignFor(null); })}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Pestaña Ingeniería (Motor de Red) ── */}
      {tab === "ingenieria" && (
        <div className="flex flex-col gap-3">
          <EngineInsights assetId={assetId} />

          {/* Trazado óptico a la raíz (saltos lógicos) */}
          {trace && trace.saltos.length > 0 && (
            <div className="border-t border-cica-border/40 pt-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Ruta óptica (saltos)</div>
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-cica-silver">
                {trace.saltos.map((s, i) => (
                  <span key={s.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-cica-muted">→</span>}
                    <span className="rounded bg-cica-border/40 px-1.5 py-0.5">
                      {s.tipo}{s.puerto != null ? ` :${s.puerto}` : ""}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PortChip({
  port, canEdit, busy, active, onAssignStart, onDisconnect,
}: {
  port: InfraPort;
  canEdit: boolean;
  busy: boolean;
  active: boolean;
  onAssignStart: () => void;
  onDisconnect: () => void;
}) {
  const libre = port.estado === "libre";
  const color = ESTADO_COLOR[port.estado] || "#8B96AC";
  return (
    <button
      disabled={!canEdit || busy}
      onClick={libre ? onAssignStart : onDisconnect}
      title={libre ? `Puerto ${port.numero} · libre — asignar` : `Puerto ${port.numero} · ${port.estado} — desconectar`}
      className={`flex flex-col items-center rounded-md border px-1 py-1.5 transition-colors disabled:cursor-default ${
        active ? "border-cica-gold bg-cica-gold/10" : "border-cica-border/60 hover:border-cica-gold/40"
      }`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="mt-0.5 text-[10px] font-semibold text-cica-silver">{port.numero}</span>
    </button>
  );
}

/** Buscador de clientes para asignar a un puerto (servicioId = id del cliente). */
function ClientePicker({ busy, onPick }: { busy: boolean; onPick: (c: Cliente) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      listClientes({ q: term })
        .then((rows) => { if (!cancelled) setResults(rows.slice(0, 8)); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar cliente por nombre o documento…"
        className="w-full rounded-md border border-cica-border/70 bg-cica-black/40 px-2 py-1 text-[11px] text-cica-silver outline-none focus:border-cica-gold/50"
      />
      {loading && <div className="mt-1 text-[10px] text-cica-muted">Buscando…</div>}
      {results.length > 0 && (
        <div className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => onPick(c)}
              className="flex flex-col rounded-md px-2 py-1 text-left hover:bg-cica-border/30 disabled:opacity-50"
            >
              <span className="truncate text-[11px] font-semibold text-cica-silver">{c.nombre}</span>
              <span className="text-[9px] text-cica-muted">{c.documento} · {c.plan}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !loading && results.length === 0 && (
        <div className="mt-1 text-[10px] text-cica-muted">Sin coincidencias.</div>
      )}
    </div>
  );
}

