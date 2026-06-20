"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createInfraFiber,
  createInfraAsset,
  deleteInfraFiber,
  deleteInfraAsset,
  setAssetParent,
  getAssetDetail,
  uploadAssetPhoto,
  deleteAssetPhoto,
  mediaUrl,
  streetViewMeta,
  streetViewImageUrl,
  type StreetViewMeta,
  type AssetPhoto,
  type PhotoCategory,
  type NapRecord,
  type ZoneRecord,
  type InfraBundle,
  type ConstructionResult,
} from "../../lib/api";

const ASSET_TYPES = ["POP", "OLT", "Switch", "Router", "NAP", "Splitter", "UPS", "Servidor", "Camara", "Empalme", "ONU", "Cliente"];
const TIPO_COLOR: Record<string, string> = {
  POP: "#F5C518", OLT: "#3E6FB0", NAP: "#22E0A1", CTO: "#22E0A1",
  Splitter: "#7FA8DD", Cliente: "#7FA8DD",
};
const dotColor = (tipo: string) => TIPO_COLOR[tipo] || "#8B96AC";

const SEMAFORO_COLOR: Record<string, string> = {
  verde: "#22E0A1", amarillo: "#FFB02E", rojo: "#FF4D6D",
};
const SEMAFORO_LABEL: Record<string, string> = {
  verde: "Disponible", amarillo: "Casi lleno", rojo: "Saturada",
};
const money = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

type Tab = "activos" | "topologia" | "cobertura" | "construccion";

type AssetFeature = {
  properties: {
    id: string; tipo: string; nombre: string; estado?: string; direccion?: string;
    padreId?: string | null; clientesDependientes?: number;
    puertosTotal?: number | null; puertosUsados?: number | null; puertosLibres?: number | null;
    semaforo?: "verde" | "amarillo" | "rojo" | null;
  };
  geometry: { coordinates: [number, number] };
};

export default function InfraPanel({
  naps,
  zones,
  canEdit,
  onFocus,
  drawing,
  drawPointsCount,
  onStartDraw,
  onUndoPoint,
  onCancelDraw,
  onSaveZone,
  infra,
  onInfraChanged,
  buildMode,
  buildResult,
  onToggleBuild,
}: {
  naps: NapRecord[];
  zones: ZoneRecord[];
  canEdit: boolean;
  onFocus: (lng: number, lat: number, color?: string) => void;
  onChanged: () => void;
  drawing: boolean;
  drawPointsCount: number;
  onStartDraw: () => void;
  onUndoPoint: () => void;
  onCancelDraw: () => void;
  onSaveZone: (nombre: string) => void;
  infra?: InfraBundle | null;
  onInfraChanged: () => void;
  buildMode: boolean;
  buildResult: ConstructionResult | null;
  onToggleBuild: () => void;
}) {
  const [tab, setTab] = useState<Tab>("activos");
  const [netErr, setNetErr] = useState<string | null>(null);

  const assets: AssetFeature[] = (infra?.assets.features as AssetFeature[]) || [];
  const fibras: any[] = infra?.fiber.features || [];

  // ---------- KPIs reales ----------
  const kpis = useMemo(() => {
    const napAssets = assets.filter((a) => a.properties.tipo === "NAP" || a.properties.tipo === "CTO");
    const clientes = assets.filter((a) => a.properties.tipo === "Cliente").length;
    const puertosTotal = naps.reduce((s, n) => s + (n.puertos_total || 0), 0);
    const puertosUsados = naps.reduce((s, n) => s + (n.puertos_usados || 0), 0);
    const librePct = puertosTotal > 0 ? Math.round(((puertosTotal - puertosUsados) / puertosTotal) * 100) : null;
    return {
      activos: infra?.stats.activos ?? assets.length,
      naps: napAssets.length || naps.length,
      clientes,
      km: ((infra?.stats.metrosFibra ?? 0) / 1000),
      librePct,
    };
  }, [assets, naps, infra]);

  return (
    <div className="flex flex-col gap-3">
      {/* ===== KPIs operativos ===== */}
      <div className="glass animate-fadeUp p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Kpi label="Activos" value={fmt(kpis.activos)} tone="gold" />
          <Kpi label="Clientes" value={fmt(kpis.clientes)} tone="ftth" />
          <Kpi label="NAPs" value={fmt(kpis.naps)} tone="silver" />
          <Kpi label="Fibra" value={`${kpis.km.toFixed(1)} km`} tone="glow" />
          <Kpi label="Capacidad libre" value={kpis.librePct === null ? "—" : `${kpis.librePct}%`} tone={kpis.librePct !== null && kpis.librePct < 20 ? "sin" : "steel"} />
          <Kpi label="Fibras" value={fmt(fibras.length)} tone="silver" />
        </div>
      </div>

      {/* ===== Tabs ===== */}
      <div className="glass animate-fadeUp grid grid-cols-4 gap-1 p-1">
        <TabButton active={tab === "activos"} onClick={() => setTab("activos")}>Activos</TabButton>
        <TabButton active={tab === "topologia"} onClick={() => setTab("topologia")}>Topología</TabButton>
        <TabButton active={tab === "cobertura"} onClick={() => setTab("cobertura")}>Cobertura</TabButton>
        <TabButton active={tab === "construccion"} onClick={() => setTab("construccion")}>Vender</TabButton>
      </div>

      {netErr && <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{netErr}</div>}

      {tab === "activos" && (
        <ActivosView assets={assets} canEdit={canEdit} naps={naps} onFocus={onFocus} onInfraChanged={onInfraChanged} setNetErr={setNetErr} />
      )}
      {tab === "topologia" && (
        <TopologiaView assets={assets} fibras={fibras} canEdit={canEdit} onFocus={onFocus} onInfraChanged={onInfraChanged} setNetErr={setNetErr} />
      )}
      {tab === "cobertura" && (
        <CoberturaView
          zones={zones}
          canEdit={canEdit}
          onFocus={onFocus}
          drawing={drawing}
          drawPointsCount={drawPointsCount}
          onStartDraw={onStartDraw}
          onUndoPoint={onUndoPoint}
          onCancelDraw={onCancelDraw}
          onSaveZone={onSaveZone}
        />
      )}
      {tab === "construccion" && (
        <ConstruccionView buildMode={buildMode} buildResult={buildResult} onToggleBuild={onToggleBuild} onFocus={onFocus} napCount={(infra?.assets.features || []).filter((f: any) => f.properties.tipo === "NAP").length} />
      )}
    </div>
  );
}

/* =================== Vista: Activos =================== */

function ActivosView({
  assets, canEdit, naps, onFocus, onInfraChanged, setNetErr,
}: {
  assets: AssetFeature[]; canEdit: boolean; naps: NapRecord[];
  onFocus: (lng: number, lat: number, color?: string) => void;
  onInfraChanged: () => void; setNetErr: (s: string | null) => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [tipo, setTipo] = useState("NAP");
  const [nombre, setNombre] = useState("");
  const [dir, setDir] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [serie, setSerie] = useState("");
  const [puertosTotal, setPuertosTotal] = useState("16");
  const [puertosUsados, setPuertosUsados] = useState("0");
  const [planMensual, setPlanMensual] = useState("");
  const [busy, setBusy] = useState(false);

  const [filtroTipo, setFiltroTipo] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      assets.filter((a) => {
        if (filtroTipo && a.properties.tipo !== filtroTipo) return false;
        if (q && !`${a.properties.nombre} ${a.properties.id}`.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [assets, filtroTipo, q],
  );

  async function crear() {
    if (dir.trim().length < 3) return;
    setBusy(true); setNetErr(null);
    try {
      const a = await createInfraAsset({
        tipo, nombre: nombre.trim() || undefined, direccion: dir.trim(),
        marca: marca.trim() || undefined, modelo: modelo.trim() || undefined, serie: serie.trim() || undefined,
        puertosTotal: tipo === "NAP" ? parseInt(puertosTotal, 10) || undefined : undefined,
        puertosUsados: tipo === "NAP" ? parseInt(puertosUsados, 10) || 0 : undefined,
        planMensual: tipo === "Cliente" ? parseInt(planMensual, 10) || undefined : undefined,
      });
      setNombre(""); setDir(""); setMarca(""); setModelo(""); setSerie(""); setPlanMensual(""); setShowNew(false);
      onInfraChanged();
      onFocus(a.lng, a.lat, "#22E0A1");
    } catch (e: any) { setNetErr(e.message || "No se pudo crear el activo"); }
    finally { setBusy(false); }
  }

  async function eliminar(id: string) {
    setNetErr(null);
    try { await deleteInfraAsset(id); if (selected === id) setSelected(null); onInfraChanged(); }
    catch (e: any) { setNetErr(e.message); }
  }

  if (selected) {
    const nap = naps.find((n) => n.id === selected);
    return <AssetDetail id={selected} nap={nap} onBack={() => setSelected(null)} onFocus={onFocus} canEdit={canEdit} onDelete={eliminar} onInfraChanged={onInfraChanged} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div className="glass animate-fadeUp p-4">
          {!showNew ? (
            <button onClick={() => setShowNew(true)} className="btn-cica w-full text-xs">+ Nuevo activo</button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cica-gold">Crear activo</span>
                <button onClick={() => setShowNew(false)} className="text-cica-muted hover:text-white">✕</button>
              </div>
              <div className="flex gap-2">
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-cica-border bg-cica-navy/80 px-2 py-2 text-xs text-cica-silver outline-none focus:border-cica-gold">
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (opcional)" className={inputCls + " flex-1"} />
              </div>
              <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Dirección o coordenada (geocodifica)" className={inputCls} />
              <div className="grid grid-cols-3 gap-2">
                <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Marca" className={inputCls} />
                <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo" className={inputCls} />
                <input value={serie} onChange={(e) => setSerie(e.target.value)} placeholder="Serie" className={inputCls} />
              </div>
              {tipo === "NAP" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">
                    Puertos totales
                    <input type="number" min={1} value={puertosTotal} onChange={(e) => setPuertosTotal(e.target.value)} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">
                    Puertos usados
                    <input type="number" min={0} value={puertosUsados} onChange={(e) => setPuertosUsados(e.target.value)} className={inputCls} />
                  </label>
                </div>
              )}
              {tipo === "Cliente" && (
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-cica-muted">
                  Plan mensual (COP)
                  <input type="number" min={0} value={planMensual} onChange={(e) => setPlanMensual(e.target.value)} placeholder="Ej: 70000" className={inputCls} />
                </label>
              )}
              <button onClick={crear} disabled={busy || dir.trim().length < 3} className="btn-cica text-xs disabled:opacity-50">
                {busy ? "Guardando…" : "Crear activo"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="glass animate-fadeUp p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-cica-muted">Inventario ({filtered.length})</span>
        </div>
        <div className="mb-2 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className={inputCls + " flex-1"} />
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-lg border border-cica-border bg-cica-navy/80 px-2 py-2 text-xs text-cica-silver outline-none focus:border-cica-gold">
            <option value="">Todos</option>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-cica-muted">Sin activos. Crea el primero con <strong>+ Nuevo activo</strong>.</p>
        ) : (
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
            {filtered.map((a) => (
              <button
                key={a.properties.id}
                onClick={() => { setSelected(a.properties.id); onFocus(a.geometry.coordinates[0], a.geometry.coordinates[1], dotColor(a.properties.tipo)); }}
                className="flex items-center justify-between gap-2 rounded-lg border border-cica-border/60 bg-cica-navy/40 px-3 py-2 text-left transition-colors hover:border-cica-gold/40"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor(a.properties.tipo), boxShadow: `0 0 6px ${dotColor(a.properties.tipo)}` }} />
                  <span className="truncate text-[11px] font-semibold text-cica-silver">{a.properties.nombre}</span>
                  <span className="text-[10px] text-cica-muted">{a.properties.tipo}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {a.properties.semaforo && a.properties.puertosTotal != null && (
                    <span
                      title={`${SEMAFORO_LABEL[a.properties.semaforo]} · ${a.properties.puertosUsados}/${a.properties.puertosTotal} puertos`}
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                      style={{ background: `${SEMAFORO_COLOR[a.properties.semaforo]}22`, color: SEMAFORO_COLOR[a.properties.semaforo] }}
                    >
                      {a.properties.puertosUsados}/{a.properties.puertosTotal}
                    </span>
                  )}
                  {(a.properties.clientesDependientes ?? 0) > 0 && (
                    <span className="rounded bg-status-ftth/15 px-1.5 py-0.5 text-[9px] font-semibold text-status-ftth">{a.properties.clientesDependientes} cli</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* =================== Ficha de activo =================== */

function AssetDetail({
  id, nap, onBack, onFocus, canEdit, onDelete, onInfraChanged,
}: {
  id: string; nap?: NapRecord; onBack: () => void;
  onFocus: (lng: number, lat: number, color?: string) => void;
  canEdit: boolean; onDelete: (id: string) => void; onInfraChanged?: () => void;
}) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setErr(null);
    getAssetDetail(id).then(setD).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    let alive = true;
    setD(null); setErr(null);
    getAssetDetail(id).then((r) => alive && setD(r)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="glass animate-fadeUp p-4">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onBack} className="text-[11px] text-cica-muted hover:text-cica-gold">← Inventario</button>
        {canEdit && <button onClick={() => onDelete(id)} className="text-[11px] text-cica-muted hover:text-status-sin">Eliminar</button>}
      </div>
      {err && <div className="text-xs text-status-sin">{err}</div>}
      {!d && !err && <div className="py-4 text-center text-[11px] text-cica-muted">Cargando ficha…</div>}
      {d && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: dotColor(d.tipo), boxShadow: `0 0 8px ${dotColor(d.tipo)}` }} />
              <span className="text-sm font-extrabold text-white">{d.nombre}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-cica-muted">{d.tipo} · {d.id} · <span className="text-cica-silver">{d.estado}</span></div>
            {d.direccion && <div className="mt-1 text-[10px] text-cica-muted line-clamp-2">{d.direccion}</div>}
          </div>

          {(d.marca || d.modelo || d.serie) && (
            <Row label="Equipo" value={[d.marca, d.modelo, d.serie].filter(Boolean).join(" · ")} />
          )}
          <Row label="Depende de" value={d.padre ? `${d.padre.nombre} (${d.padre.tipo})` : "— raíz"} />
          {d.ancestros?.length > 0 && (
            <Row label="Cadena" value={[...d.ancestros].reverse().map((p: any) => p.nombre).join(" → ")} />
          )}
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Clientes" value={fmt(d.impacto?.clientesDependientes ?? d.clientesDependientes ?? 0)} />
            <MiniStat label="NAPs" value={fmt(d.impacto?.napsDependientes ?? 0)} />
            <MiniStat label="Descendientes" value={fmt(d.descendientes?.length ?? 0)} />
          </div>

          {/* Impacto: ingresos mensuales asociados (R14) */}
          {(d.impacto?.ingresosMensuales ?? 0) > 0 && (
            <div className="rounded-lg border border-status-sin/30 bg-status-sin/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-cica-muted">Impacto si falla</div>
              <div className="mt-0.5 text-sm font-extrabold text-status-sin">
                {money(d.impacto.ingresosMensuales)}<span className="ml-1 text-[10px] font-normal text-cica-muted">/mes en riesgo</span>
              </div>
              <div className="text-[10px] text-cica-muted">{d.impacto.clientesDependientes} cliente(s) sin servicio</div>
            </div>
          )}

          {/* Capacidad con semáforo (R9) */}
          {d.capacidad && (
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-cica-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: SEMAFORO_COLOR[d.capacidad.semaforo], boxShadow: `0 0 6px ${SEMAFORO_COLOR[d.capacidad.semaforo]}` }} />
                  Capacidad · {SEMAFORO_LABEL[d.capacidad.semaforo]}
                </span>
                <span className="font-semibold text-cica-silver">{d.capacidad.usados}/{d.capacidad.total}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-cica-border">
                <div className="h-full rounded-full" style={{ width: `${d.capacidad.total ? (d.capacidad.usados / d.capacidad.total) * 100 : 0}%`, background: SEMAFORO_COLOR[d.capacidad.semaforo] }} />
              </div>
              <div className="mt-1 text-right text-[10px] text-cica-muted">{d.capacidad.libres} puerto(s) libre(s)</div>
            </div>
          )}

          {/* Street View (solo aparece donde Google tiene panorámica) */}
          <StreetViewSection lat={d.lat} lng={d.lng} nombre={d.nombre} />

          {/* Evidencia fotográfica georreferenciada — la "vista de calle" propia */}
          <EvidenciaSection assetId={d.id} fotos={d.fotos || []} canEdit={canEdit} onChanged={() => { load(); onInfraChanged?.(); }} />

          <button onClick={() => onFocus(d.lng, d.lat, dotColor(d.tipo))} className="rounded-lg border border-cica-border bg-cica-navy/60 px-2 py-1.5 text-[11px] text-cica-silver transition-colors hover:border-cica-gold/40">
            Ver en el mapa
          </button>
        </div>
      )}
    </div>
  );
}

/* =================== Street View (Google, gateado por disponibilidad) =================== */

function StreetViewSection({ lat, lng, nombre }: { lat: number; lng: number; nombre: string }) {
  const [meta, setMeta] = useState<StreetViewMeta | null>(null);
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [fov, setFov] = useState(90);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    streetViewMeta(lat, lng).then((m) => alive && setMeta(m)).catch(() => alive && setMeta({ disponible: false } as any));
    return () => { alive = false; };
  }, [lat, lng]);

  // No mostramos nada donde Google no tiene panorámica (los callejones).
  if (!meta || !meta.disponible) return null;

  const svLat = meta.lat ?? lat;
  const svLng = meta.lng ?? lng;
  const rot = (delta: number) => setHeading((h) => (h + delta + 360) % 360);
  const tilt = (delta: number) => setPitch((p) => Math.max(-90, Math.min(90, p + delta)));
  const zoom = (delta: number) => setFov((f) => Math.max(20, Math.min(120, f + delta)));
  const gmaps = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${svLat},${svLng}`;

  return (
    <div className="rounded-lg border border-cica-glow/30 bg-cica-navy/30 p-3">
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-cica-glow/40 bg-cica-glow/10 px-3 py-2 text-[11px] font-bold text-cica-glow transition-colors hover:bg-cica-glow/20"
      >
        🛣️ Ver Street View {meta.fecha ? <span className="font-normal text-cica-muted">· {meta.fecha}</span> : null}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-extrabold text-white">🛣️ {nombre}</span>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg">✕</button>
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={streetViewImageUrl({ lat: svLat, lng: svLng, heading, pitch, fov })}
                alt={`Street View de ${nombre}`}
                className="w-full select-none"
                draggable={false}
              />
            </div>
            {/* Controles tipo Street View */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <SvBtn onClick={() => rot(-45)}>⟲ Izq.</SvBtn>
              <SvBtn onClick={() => tilt(15)}>▲ Arriba</SvBtn>
              <SvBtn onClick={() => tilt(-15)}>▼ Abajo</SvBtn>
              <SvBtn onClick={() => rot(45)}>Der. ⟳</SvBtn>
              <SvBtn onClick={() => zoom(-15)}>＋ Zoom</SvBtn>
              <SvBtn onClick={() => zoom(15)}>－ Zoom</SvBtn>
              <a
                href={gmaps}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-cica-gold/40 bg-cica-gold/10 px-3 py-1.5 text-[11px] font-semibold text-cica-gold hover:bg-cica-gold/20"
              >
                Abrir en Google Maps ↗
              </a>
            </div>
            <p className="mt-2 text-center text-[10px] text-cica-muted">
              Imagen © Google · arrastra los controles para mirar alrededor
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SvBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-cica-border bg-cica-navy/70 px-3 py-1.5 text-[11px] font-semibold text-cica-silver transition-colors hover:border-cica-glow/50 hover:text-white"
    >
      {children}
    </button>
  );
}

/* =================== Evidencia fotográfica (vista de calle propia) =================== */

const PHOTO_CATS: { id: PhotoCategory; label: string; icon: string }[] = [
  { id: "vista_general", label: "Vista general", icon: "🏠" },
  { id: "frontal", label: "Frontal", icon: "📸" },
  { id: "placa_serial", label: "Placa / serial", icon: "🔖" },
  { id: "instalacion", label: "Instalación", icon: "🔧" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(PHOTO_CATS.map((c) => [c.id, c.label]));

function EvidenciaSection({
  assetId, fotos, canEdit, onChanged,
}: {
  assetId: string; fotos: AssetPhoto[]; canEdit: boolean; onChanged: () => void;
}) {
  const [cat, setCat] = useState<PhotoCategory>("vista_general");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<AssetPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      await uploadAssetPhoto(assetId, file, cat);
      onChanged();
    } catch (e: any) {
      setErr(e.message || "No se pudo subir la foto");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (camRef.current) camRef.current.value = "";
    }
  }

  async function remove(photoId: string) {
    setErr(null);
    try { await deleteAssetPhoto(assetId, photoId); onChanged(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="rounded-lg border border-cica-border/60 bg-cica-navy/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cica-muted">
          <span className="text-cica-gold">◉</span> Evidencia en terreno
          {fotos.length > 0 && <span className="text-cica-muted">· {fotos.length}</span>}
        </span>
      </div>

      {fotos.length === 0 ? (
        <p className="py-3 text-center text-[10px] text-cica-muted">
          Sin fotos. {canEdit ? "Sube la vista real del activo." : "Aún no hay evidencia."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {fotos.map((f) => (
            <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md border border-cica-border/60">
              <img
                src={mediaUrl(f.url)}
                alt={CAT_LABEL[f.categoria] || f.categoria}
                loading="lazy"
                onClick={() => setLightbox(f)}
                className="h-full w-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-110"
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-[8px] font-semibold text-white">
                {CAT_LABEL[f.categoria] || f.categoria}
              </span>
              {canEdit && (
                <button
                  onClick={() => remove(f.id)}
                  title="Eliminar foto"
                  className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-white hover:bg-status-sin group-hover:flex"
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <div className="mt-2 text-[10px] text-status-sin">{err}</div>}

      {canEdit && (
        <div className="mt-2 flex items-center gap-1.5">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value as PhotoCategory)}
            className="flex-1 rounded-lg border border-cica-border bg-cica-navy/80 px-2 py-1.5 text-[10px] text-cica-silver outline-none focus:border-cica-gold"
          >
            {PHOTO_CATS.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} className="hidden" />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="hidden"
          />
          <button
            onClick={() => camRef.current?.click()}
            disabled={busy}
            title="Tomar foto con la cámara (móvil)"
            className="btn-cica px-3 py-1.5 text-[10px] disabled:opacity-50"
          >
            {busy ? "…" : "📸"}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-cica-border bg-cica-navy/70 px-3 py-1.5 text-[10px] font-semibold text-cica-silver hover:border-cica-gold/40 disabled:opacity-50"
          >
            {busy ? "Subiendo…" : "Archivo"}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
        >
          <div className="relative max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <img src={mediaUrl(lightbox.url)} alt={CAT_LABEL[lightbox.categoria]} className="max-h-[80vh] rounded-lg object-contain" />
            <div className="mt-2 flex items-center justify-between text-[11px] text-cica-silver">
              <span className="font-semibold text-white">{CAT_LABEL[lightbox.categoria] || lightbox.categoria}</span>
              <span className="text-cica-muted">
                {new Date(lightbox.subidoEn).toLocaleString("es-CO")}{lightbox.autor ? ` · ${lightbox.autor}` : ""}
              </span>
            </div>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg"
            >✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =================== Vista: Topología =================== */

function TopologiaView({  assets, fibras, canEdit, onFocus, onInfraChanged, setNetErr,
}: {
  assets: AssetFeature[]; fibras: any[]; canEdit: boolean;
  onFocus: (lng: number, lat: number, color?: string) => void;
  onInfraChanged: () => void; setNetErr: (s: string | null) => void;
}) {
  const [origenId, setOrigenId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [tipoFibra, setTipoFibra] = useState<"monomodo" | "multimodo">("monomodo");
  const [hilos, setHilos] = useState("12");
  const [busy, setBusy] = useState(false);

  async function crearTramo() {
    if (!origenId || !destinoId || origenId === destinoId) return;
    setBusy(true); setNetErr(null);
    try {
      const f = await createInfraFiber({ origenId, destinoId, tipoFibra, hilos: parseInt(hilos, 10) || undefined });
      setOrigenId(""); setDestinoId("");
      onInfraChanged();
      onFocus(f.origen.lng, f.origen.lat, "#FFD24A");
    } catch (e: any) { setNetErr(e.message || "No se pudo crear el tramo"); }
    finally { setBusy(false); }
  }

  async function quitarFibra(id: string) {
    setNetErr(null);
    try { await deleteInfraFiber(id); onInfraChanged(); } catch (e: any) { setNetErr(e.message); }
  }
  async function conectarPadre(id: string, parentId: string) {
    setNetErr(null);
    try { await setAssetParent(id, parentId || null); onInfraChanged(); } catch (e: any) { setNetErr(e.message); }
  }

  const tree = useMemo(() => buildTree(assets), [assets]);

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-cica-gold">Nuevo tramo de fibra</div>
          <p className="mb-3 text-[11px] leading-relaxed text-cica-muted">Conecta dos activos existentes. La red se construye por activos, no por direcciones.</p>
          {assets.length < 2 ? (
            <p className="text-[11px] text-cica-muted">Necesitas al menos 2 activos. Créalos en la pestaña <strong>Activos</strong>.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-cica-muted">Origen</label>
              <select value={origenId} onChange={(e) => setOrigenId(e.target.value)} className={inputCls}>
                <option value="">Seleccionar origen…</option>
                {assets.map((a) => <option key={a.properties.id} value={a.properties.id}>{a.properties.nombre} ({a.properties.tipo})</option>)}
              </select>
              <label className="text-[10px] font-bold uppercase tracking-wider text-cica-muted">Destino</label>
              <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className={inputCls}>
                <option value="">Seleccionar destino…</option>
                {assets.filter((a) => a.properties.id !== origenId).map((a) => <option key={a.properties.id} value={a.properties.id}>{a.properties.nombre} ({a.properties.tipo})</option>)}
              </select>
              <div className="flex gap-2">
                <select value={tipoFibra} onChange={(e) => setTipoFibra(e.target.value as any)} className={inputCls + " flex-1"}>
                  <option value="monomodo">Monomodo</option>
                  <option value="multimodo">Multimodo</option>
                </select>
                <select value={hilos} onChange={(e) => setHilos(e.target.value)} className={inputCls + " flex-1"}>
                  {["6", "12", "24", "48", "96", "144"].map((h) => <option key={h} value={h}>{h} hilos</option>)}
                </select>
              </div>
              <button onClick={crearTramo} disabled={busy || !origenId || !destinoId || origenId === destinoId} className="btn-cica text-xs disabled:opacity-50">
                {busy ? "Guardando…" : "Crear tramo"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Árbol de topología lógica */}
      <div className="glass animate-fadeUp p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-cica-muted">Jerarquía lógica</div>
        {tree.roots.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-cica-muted">Sin activos.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto pr-1 font-mono text-[11px]">
            {tree.roots.map((r) => <TreeNode key={r.properties.id} node={r} depth={0} childrenOf={tree.childrenOf} onFocus={onFocus} canEdit={canEdit} assets={assets} onSetParent={conectarPadre} />)}
          </div>
        )}
      </div>

      {/* Tramos físicos */}
      {fibras.length > 0 && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-cica-muted">Tramos de fibra ({fibras.length})</div>
          <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1">
            {fibras.map((f) => (
              <div key={f.properties.id} className="flex items-center justify-between gap-2 rounded-lg border border-cica-glow/30 bg-cica-navy/40 px-3 py-1.5">
                <button onClick={() => onFocus(f.geometry.coordinates[0][0], f.geometry.coordinates[0][1], "#FFD24A")} className="truncate text-left text-[11px] font-semibold text-cica-glow hover:underline">
                  🟡 {f.properties.nombre} <span className="text-cica-muted">· {f.properties.longitud} m{f.properties.hilos ? ` · ${f.properties.hilos}h` : ""}</span>
                </button>
                {canEdit && <button onClick={() => quitarFibra(f.properties.id)} className="shrink-0 text-cica-muted hover:text-status-sin">✕</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TreeNode({
  node, depth, childrenOf, onFocus, canEdit, assets, onSetParent,
}: {
  node: AssetFeature; depth: number; childrenOf: Map<string, AssetFeature[]>;
  onFocus: (lng: number, lat: number, color?: string) => void;
  canEdit: boolean; assets: AssetFeature[]; onSetParent: (id: string, parentId: string) => void;
}) {
  const kids = childrenOf.get(node.properties.id) || [];
  const p = node.properties;
  return (
    <>
      <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-cica-navy/40" style={{ paddingLeft: depth * 14 + 4 }}>
        <span className="text-cica-muted">{depth > 0 ? "├─" : ""}</span>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotColor(p.tipo) }} />
        <button onClick={() => onFocus(node.geometry.coordinates[0], node.geometry.coordinates[1], dotColor(p.tipo))} className="truncate text-cica-silver hover:underline">
          {p.nombre} <span className="text-cica-muted">{p.tipo}</span>
        </button>
        {(p.clientesDependientes ?? 0) > 0 && <span className="text-[9px] text-status-ftth">·{p.clientesDependientes}cli</span>}
        {p.semaforo && p.puertosTotal != null && (
          <span className="text-[9px]" style={{ color: SEMAFORO_COLOR[p.semaforo] }} title={`${p.puertosUsados}/${p.puertosTotal} puertos`}>
            ·{p.puertosUsados}/{p.puertosTotal}
          </span>
        )}
        {canEdit && (
          <select
            value={p.padreId || ""}
            onChange={(e) => onSetParent(p.id, e.target.value)}
            title="Conectar a padre"
            className="ml-auto max-w-[90px] rounded border border-cica-border bg-cica-navy/80 px-1 py-0.5 text-[9px] text-cica-muted outline-none focus:border-cica-gold"
          >
            <option value="">↳ raíz</option>
            {assets.filter((o) => o.properties.id !== p.id).map((o) => (
              <option key={o.properties.id} value={o.properties.id}>{o.properties.nombre}</option>
            ))}
          </select>
        )}
      </div>
      {kids.map((k) => <TreeNode key={k.properties.id} node={k} depth={depth + 1} childrenOf={childrenOf} onFocus={onFocus} canEdit={canEdit} assets={assets} onSetParent={onSetParent} />)}
    </>
  );
}

/* =================== Vista: Cobertura =================== */

function CoberturaView({
  zones, canEdit, onFocus, drawing, drawPointsCount, onStartDraw, onUndoPoint, onCancelDraw, onSaveZone,
}: {
  zones: ZoneRecord[]; canEdit: boolean;
  onFocus: (lng: number, lat: number, color?: string) => void;
  drawing: boolean; drawPointsCount: number;
  onStartDraw: () => void; onUndoPoint: () => void; onCancelDraw: () => void; onSaveZone: (n: string) => void;
}) {
  const [zoneName, setZoneName] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-cica-muted">Zona de cobertura</div>
          {!drawing ? (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-cica-muted">Dibuja tu cobertura real sobre el mapa. Las direcciones dentro contarán como zona de servicio.</p>
              <button onClick={onStartDraw} className="btn-cica w-full">✏️ Dibujar zona en el mapa</button>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border border-cica-gold/40 bg-cica-gold/10 px-3 py-2 text-[11px] text-cica-silver">
                Haz clic en el mapa para marcar el contorno. <strong>{drawPointsCount}</strong> punto(s) · mínimo 3.
              </div>
              <input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Nombre de la zona" className={inputCls} />
              <div className="grid grid-cols-3 gap-2">
                <button onClick={onUndoPoint} disabled={drawPointsCount === 0} className="rounded-lg border border-cica-border bg-cica-navy/60 px-2 py-1.5 text-xs text-cica-silver transition-colors hover:border-cica-gold/40 disabled:opacity-40">Deshacer</button>
                <button onClick={onCancelDraw} className="rounded-lg border border-cica-border bg-cica-navy/60 px-2 py-1.5 text-xs text-cica-muted transition-colors hover:text-status-sin">Cancelar</button>
                <button onClick={() => { onSaveZone(zoneName.trim()); setZoneName(""); }} disabled={drawPointsCount < 3} className="btn-cica px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">Guardar</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="glass animate-fadeUp p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-cica-muted">Zonas ({zones.length})</div>
        {zones.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-cica-muted">Sin zonas dibujadas.</p>
        ) : (
          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
            {zones.map((z) => (
              <button key={z.id} onClick={() => z.anillo[0] && onFocus(z.anillo[0][0], z.anillo[0][1], "#22E0A1")} className="flex items-center justify-between gap-2 rounded-lg border border-status-ftth/30 bg-cica-navy/40 px-3 py-2 text-left">
                <span className="text-xs font-semibold text-status-ftth hover:underline">{z.nombre} <span className="text-cica-muted">· {z.anillo.length - 1} vértices</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* =================== Vista: Construcción (Simulador de venta) =================== */

function ConstruccionView({
  buildMode, buildResult, onToggleBuild, onFocus, napCount,
}: {
  buildMode: boolean;
  buildResult: ConstructionResult | null;
  onToggleBuild: () => void;
  onFocus: (lng: number, lat: number, color?: string) => void;
  napCount: number;
}) {
  const instalable = buildResult?.resultado === "instalable";
  const causaLabel: Record<string, string> = {
    sin_puertos: "La NAP más cercana no tiene puertos libres",
    fuera_de_alcance: "El punto está fuera del alcance de tendido de la NAP",
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="glass animate-fadeUp p-4">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-cica-gold">Simulador de venta</div>
        <p className="mb-3 text-[11px] leading-relaxed text-cica-muted">
          Marca en el mapa dónde un cliente pide servicio y CICANET evalúa al instante si es instalable, desde qué NAP, a qué distancia, costo y tiempo.
        </p>
        {napCount === 0 ? (
          <p className="rounded-lg border border-status-parcial/40 bg-status-parcial/10 px-3 py-2 text-[11px] text-status-parcial">
            Aún no hay NAPs registradas. Crea NAPs (con puertos) en la pestaña <strong>Activos</strong> para poder simular ventas.
          </p>
        ) : (
          <button
            onClick={onToggleBuild}
            className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              buildMode ? "bg-status-sin/20 text-status-sin" : "btn-cica"
            }`}
          >
            {buildMode ? "● Desactivar simulador" : "📍 Activar — clic en el mapa"}
          </button>
        )}
        {buildMode && !buildResult && (
          <p className="mt-2 text-[11px] text-cica-gold">Haz clic en el punto del cliente en el mapa…</p>
        )}
      </div>

      {buildResult && (
        <div className="glass animate-fadeUp p-4">
          <div className={`mb-2 text-sm font-extrabold ${instalable ? "text-status-ftth" : "text-status-sin"}`}>
            {instalable ? "✓ Instalable" : "✕ No instalable"}
          </div>
          {!instalable && buildResult.causa && (
            <p className="mb-2 text-[11px] text-cica-muted">{causaLabel[buildResult.causa] || buildResult.causa}</p>
          )}
          {buildResult.nap ? (
            <div className="flex flex-col gap-2">
              <Row label="NAP más cercana" value={buildResult.nap.nombre} />
              <Row label="Distancia de tendido" value={`${buildResult.distanciaTendido ?? "—"} m`} />
              <Row label="Puertos libres" value={String(buildResult.puertosLibres ?? "—")} />
              <Row label="Costo estimado" value={buildResult.costoEstimado != null ? money(buildResult.costoEstimado) : "—"} />
              <Row label="Tiempo estimado" value={buildResult.tiempoEstimadoDias != null ? `${buildResult.tiempoEstimadoDias} día(s)` : "—"} />
              <button
                onClick={() => buildResult.nap && onFocus(buildResult.nap.lng, buildResult.nap.lat, "#22E0A1")}
                className="mt-1 rounded-lg border border-cica-border bg-cica-navy/60 px-2 py-1.5 text-[11px] text-cica-silver transition-colors hover:border-cica-gold/40"
              >
                Ver la NAP en el mapa
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-cica-muted">No se encontró ninguna NAP para evaluar.</p>
          )}
          <p className="mt-3 text-[10px] text-cica-muted">Distancia en línea recta (aproximada). El cálculo por rutas reales requiere motor de ruteo.</p>
        </div>
      )}
    </div>
  );
}

/* =================== Helpers UI =================== */
const inputCls = "rounded-lg border border-cica-border bg-cica-navy/80 px-3 py-2 text-xs text-cica-silver outline-none focus:border-cica-gold";

function buildTree(assets: AssetFeature[]) {
  const byId = new Map(assets.map((a) => [a.properties.id, a]));
  const childrenOf = new Map<string, AssetFeature[]>();
  const roots: AssetFeature[] = [];
  for (const a of assets) {
    const pid = a.properties.padreId;
    if (pid && byId.has(pid)) {
      const arr = childrenOf.get(pid) || [];
      arr.push(a);
      childrenOf.set(pid, arr);
    } else {
      roots.push(a);
    }
  }
  return { roots, childrenOf };
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-CO").format(n);
}

const TONE: Record<string, string> = {
  gold: "text-cica-gold", glow: "text-cica-glow", steel: "text-cica-steelLight",
  silver: "text-cica-silver", ftth: "text-status-ftth", sin: "text-status-sin",
};

function Kpi({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONE }) {
  return (
    <div>
      <div className={`text-base font-extrabold ${TONE[tone]}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-cica-muted">{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${active ? "bg-cica-gold/15 text-cica-gold" : "text-cica-muted hover:text-cica-silver"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-cica-border/40 pb-1.5 text-[11px]">
      <span className="text-cica-muted">{label}</span>
      <span className="text-right font-semibold text-cica-silver">{value}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-cica-border/60 bg-cica-navy/40 px-2 py-1.5 text-center">
      <div className="text-sm font-extrabold text-cica-silver">{value}</div>
      <div className="text-[9px] text-cica-muted">{label}</div>
    </div>
  );
}
