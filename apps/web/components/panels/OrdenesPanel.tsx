"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listOrdenes,
  ordenesStats,
  createOrden,
  asignarOrden,
  updateOrdenEstado,
  deleteOrden,
  listTecnicos,
  type OrdenTrabajo,
  type OrdenStats,
  type OrdenEstado,
  type OrdenTipo,
  type OrdenPrioridad,
  type Tecnico,
} from "../../lib/api";

const ESTADO_META: Record<OrdenEstado, { label: string; color: string; bg: string }> = {
  asignada: { label: "Asignada", color: "#8B96AC", bg: "rgba(139,150,172,0.15)" },
  en_camino: { label: "En camino", color: "#3B82F6", bg: "rgba(59,130,246,0.18)" },
  en_sitio: { label: "En sitio", color: "#FFB02E", bg: "rgba(255,176,46,0.18)" },
  completada: { label: "Completada", color: "#22E0A1", bg: "rgba(34,224,161,0.16)" },
  cancelada: { label: "Cancelada", color: "#FF4D6D", bg: "rgba(255,77,109,0.16)" },
};

const TIPO_LABEL: Record<OrdenTipo, string> = {
  instalacion: "Instalación",
  visita: "Visita",
  reparacion: "Reparación",
};

const PRIORIDAD_META: Record<OrdenPrioridad, { label: string; color: string }> = {
  baja: { label: "Baja", color: "#8B96AC" },
  media: { label: "Media", color: "#FFB02E" },
  alta: { label: "Alta", color: "#FF4D6D" },
};

const FILTROS: { key: string; label: string }[] = [
  { key: "", label: "Todas" },
  { key: "asignada", label: "Asignadas" },
  { key: "en_camino", label: "En camino" },
  { key: "en_sitio", label: "En sitio" },
  { key: "completada", label: "Completadas" },
  { key: "cancelada", label: "Canceladas" },
];

export default function OrdenesPanel({ canEdit }: { canEdit: boolean }) {
  const [ordenes, setOrdenes] = useState<OrdenTrabajo[]>([]);
  const [stats, setStats] = useState<OrdenStats | null>(null);
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [filtro, setFiltro] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detalle, setDetalle] = useState<OrdenTrabajo | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([listOrdenes(filtro ? { estado: filtro } : {}), ordenesStats()]);
      setOrdenes(o);
      setStats(s);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  useEffect(() => {
    listTecnicos().then(setTecnicos).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white">Órdenes de trabajo</h2>
          <p className="text-xs text-cica-muted">
            Asigna instalaciones y visitas a los técnicos. Ellos las ejecutan y suben la evidencia desde su app.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black shadow-glow transition-transform hover:scale-[1.02]"
          >
            + Nueva orden
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Total" value={String(stats?.total ?? 0)} color="text-cica-silver" />
        <Kpi label="Activas" value={String(stats?.activas ?? 0)} color="text-cica-gold" />
        <Kpi label="Asignadas" value={String(stats?.porEstado.asignada ?? 0)} color="text-cica-steelLight" />
        <Kpi label="En sitio" value={String(stats?.porEstado.en_sitio ?? 0)} color="text-status-parcial" />
        <Kpi label="Completadas" value={String(stats?.porEstado.completada ?? 0)} color="text-status-ftth" />
        <Kpi label="Canceladas" value={String(stats?.porEstado.cancelada ?? 0)} color="text-status-sin" />
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.key || "todas"}
            onClick={() => setFiltro(f.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              filtro === f.key ? "bg-cica-gold/20 text-cica-gold" : "bg-cica-border/30 text-cica-muted hover:text-cica-silver"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{error}</div>}

      {/* Lista */}
      {loading ? (
        <div className="grid place-items-center py-16 text-cica-muted">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
        </div>
      ) : ordenes.length === 0 ? (
        <div className="glass grid place-items-center py-16 text-center text-cica-muted">
          <p className="text-sm">No hay órdenes {filtro ? "con este estado" : "todavía"}.</p>
          {canEdit && !filtro && <p className="mt-1 text-xs">Crea la primera con “+ Nueva orden”.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {ordenes.map((o) => (
            <OrdenCard key={o.id} o={o} tecnicos={tecnicos} canEdit={canEdit} onChanged={refresh} onOpen={() => setDetalle(o)} />
          ))}
        </div>
      )}

      {showForm && (
        <OrdenForm
          tecnicos={tecnicos}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}
      {detalle && <OrdenDetalle o={detalle} onClose={() => setDetalle(null)} />}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass p-3">
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
      <div className="text-[10px] font-semibold text-cica-muted">{label}</div>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: OrdenEstado }) {
  const m = ESTADO_META[estado];
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: m.color, background: m.bg }}>
      {m.label}
    </span>
  );
}

function OrdenCard({
  o, tecnicos, canEdit, onChanged, onOpen,
}: {
  o: OrdenTrabajo;
  tecnicos: Tecnico[];
  canEdit: boolean;
  onChanged: () => void;
  onOpen: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fecha = o.fechaProgramada ? new Date(o.fechaProgramada).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : null;
  const prio = PRIORIDAD_META[o.prioridad];
  const tecNombre = tecnicos.find((t) => t.username === o.tecnico)?.nombre ?? o.tecnico;

  async function reasignar(tecnico: string) {
    setBusy(true);
    try { await asignarOrden(o.id, tecnico || null); onChanged(); } finally { setBusy(false); }
  }
  async function cancelar() {
    if (!confirm(`¿Cancelar la orden ${o.codigo}?`)) return;
    setBusy(true);
    try { await updateOrdenEstado(o.id, "cancelada"); onChanged(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function eliminar() {
    if (!confirm(`¿Eliminar definitivamente ${o.codigo}? Esto borra su evidencia.`)) return;
    setBusy(true);
    try { await deleteOrden(o.id); onChanged(); } finally { setBusy(false); }
  }

  return (
    <div className="glass p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-cica-gold">{o.codigo}</span>
            <span className="text-[10px] text-cica-muted">· {TIPO_LABEL[o.tipo]}</span>
            <span className="text-[10px] font-semibold" style={{ color: prio.color }}>· {prio.label}</span>
          </div>
          <button onClick={onOpen} className="mt-0.5 text-left text-sm font-semibold text-white hover:text-cica-gold">
            {o.titulo}
          </button>
          <div className="mt-0.5 text-[11px] text-cica-muted line-clamp-1">{o.direccion}</div>
          {o.clienteNombre && <div className="text-[11px] text-cica-steelLight">Cliente: {o.clienteNombre}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-cica-muted">
            {fecha && <span>📅 {fecha}</span>}
            {(o.fotos?.length ?? 0) > 0 && <span>📷 {o.fotos!.length} foto(s)</span>}
            <span>👷 {tecNombre || "Sin asignar"}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <EstadoBadge estado={o.estado} />
          {canEdit && o.estado !== "completada" && o.estado !== "cancelada" && (
            <div className="flex items-center gap-1.5">
              <select
                value={o.tecnico ?? ""}
                onChange={(e) => reasignar(e.target.value)}
                disabled={busy}
                className="rounded-lg border border-cica-border bg-cica-panel px-2 py-1 text-[11px] text-cica-silver"
                title="Reasignar técnico"
              >
                <option value="">Sin asignar</option>
                {tecnicos.map((t) => (
                  <option key={t.username} value={t.username}>{t.nombre}</option>
                ))}
              </select>
              <button onClick={cancelar} disabled={busy} className="rounded-lg border border-status-sin/40 px-2 py-1 text-[11px] text-status-sin hover:bg-status-sin/10">
                Cancelar
              </button>
            </div>
          )}
          {canEdit && (o.estado === "completada" || o.estado === "cancelada") && (
            <button onClick={eliminar} disabled={busy} className="text-[10px] text-cica-muted hover:text-status-sin">
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OrdenForm({ tecnicos, onClose, onSaved }: { tecnicos: Tecnico[]; onClose: () => void; onSaved: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<OrdenTipo>("instalacion");
  const [prioridad, setPrioridad] = useState<OrdenPrioridad>("media");
  const [direccion, setDireccion] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [tecnico, setTecnico] = useState("");
  const [fechaProgramada, setFechaProgramada] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valido = titulo.trim().length >= 3 && direccion.trim().length >= 3;

  async function guardar() {
    if (!valido) return;
    setSaving(true);
    setErr(null);
    try {
      await createOrden({
        titulo: titulo.trim(),
        direccion: direccion.trim(),
        tipo,
        prioridad,
        tecnico: tecnico || undefined,
        clienteNombre: clienteNombre.trim() || undefined,
        contacto: contacto.trim() || undefined,
        fechaProgramada: fechaProgramada || undefined,
        descripcion: descripcion.trim() || undefined,
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Nueva orden de trabajo">
      <div className="flex flex-col gap-3">
        {err && <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}
        <Field label="Título *">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Instalación FTTH" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as OrdenTipo)} className={inputCls}>
              <option value="instalacion">Instalación</option>
              <option value="visita">Visita</option>
              <option value="reparacion">Reparación</option>
            </select>
          </Field>
          <Field label="Prioridad">
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as OrdenPrioridad)} className={inputCls}>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
            </select>
          </Field>
        </div>
        <Field label="Dirección *">
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle 00 #00-00, barrio" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cliente (nombre)">
            <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Opcional" className={inputCls} />
          </Field>
          <Field label="Contacto">
            <input value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Teléfono en sitio" className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Asignar a técnico">
            <select value={tecnico} onChange={(e) => setTecnico(e.target.value)} className={inputCls}>
              <option value="">Sin asignar</option>
              {tecnicos.map((t) => (
                <option key={t.username} value={t.username}>{t.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha programada">
            <input type="datetime-local" value={fechaProgramada} onChange={(e) => setFechaProgramada(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Descripción / instrucciones">
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Detalles para el técnico…" className={inputCls} />
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-cica-muted hover:text-cica-silver">Cancelar</button>
          <button
            onClick={guardar}
            disabled={!valido || saving}
            className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Crear y asignar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function OrdenDetalle({ o, onClose }: { o: OrdenTrabajo; onClose: () => void }) {
  const fecha = o.fechaProgramada ? new Date(o.fechaProgramada).toLocaleString("es-CO", { dateStyle: "full", timeStyle: "short" }) : "Sin programar";
  return (
    <Modal onClose={onClose} title={`${o.codigo} · ${TIPO_LABEL[o.tipo]}`}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-white">{o.titulo}</span>
          <EstadoBadge estado={o.estado} />
        </div>
        <Info label="Dirección" value={o.direccion} />
        {o.clienteNombre && <Info label="Cliente" value={o.clienteNombre} />}
        {o.contacto && <Info label="Contacto" value={o.contacto} />}
        <Info label="Técnico" value={o.tecnico ?? "Sin asignar"} />
        <Info label="Programada" value={fecha} />
        {o.descripcion && <Info label="Instrucciones" value={o.descripcion} />}
        {o.notasTecnico && <Info label="Notas del técnico" value={o.notasTecnico} />}

        {(o.fotos?.length ?? 0) > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Evidencia ({o.fotos!.length})</div>
            <div className="grid grid-cols-3 gap-2">
              {o.fotos!.map((f) => (
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-lg border border-cica-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.nota || "evidencia"} className="h-24 w-full object-cover transition-transform group-hover:scale-105" />
                  {f.nota && <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[9px] text-white line-clamp-1">{f.nota}</div>}
                </a>
              ))}
            </div>
          </div>
        )}

        {(o.historial?.length ?? 0) > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Historial</div>
            <div className="flex flex-col gap-1">
              {o.historial!.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-cica-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-cica-gold" />
                  <span className="text-cica-silver">{ESTADO_META[h.estado as OrdenEstado]?.label ?? h.estado}</span>
                  <span>· {new Date(h.ts).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
                  {h.por && <span>· {h.por}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-cica-muted">{label}</div>
      <div className="text-cica-silver">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-cica-muted">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-white">{title}</h3>
          <button onClick={onClose} className="text-cica-muted hover:text-white">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-cica-border bg-cica-panel px-3 py-2 text-sm text-cica-silver placeholder:text-cica-muted focus:border-cica-gold focus:outline-none";
