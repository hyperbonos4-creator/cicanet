"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listTickets,
  ticketStats,
  updateTicketEstado,
  getCliente360,
  type Ticket,
  type TicketStats,
  type Cliente360,
} from "../../lib/api";

const ESTADOS: { key: string; label: string; color: string }[] = [
  { key: "abierto", label: "Abierto", color: "text-status-sin" },
  { key: "en_proceso", label: "En proceso", color: "text-cica-amber" },
  { key: "resuelto", label: "Resuelto", color: "text-status-ftth" },
  { key: "cerrado", label: "Cerrado", color: "text-cica-muted" },
];

const CAT_LABEL: Record<string, string> = {
  tecnico: "Técnico",
  facturacion: "Facturación",
  comercial: "Comercial",
  general: "General",
};

const money = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

/**
 * Bandeja de tickets de soporte. Al seleccionar un ticket abre un panel lateral
 * con el 360 del cliente (identidad, ubicación, servicio y los equipos de red que
 * comprometen su conexión) y un botón "Mapa" para verlo en el mapa.
 */
export default function TicketsPanel({ onVerEnMapa }: { onVerEnMapa?: (lng: number, lat: number) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [filtro, setFiltro] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([listTickets(filtro || undefined), ticketStats()]);
      setTickets(t);
      setStats(s);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => {
    load();
  }, [load]);

  async function cambiarEstado(id: string, estado: string) {
    try {
      await updateTicketEstado(id, estado);
      setSel((s) => (s && s.id === id ? { ...s, estado: estado as Ticket["estado"] } : s));
      await load();
    } catch {
      /* noop */
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="mb-1 text-xl font-extrabold text-white">Tickets de soporte</h2>
      <p className="mb-4 text-xs text-cica-muted">
        Solicitudes creadas por el asistente <span className="text-cica-silver">Cica</span> y por el equipo.
        Toca un ticket para ver el detalle del cliente y su red.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={filtro === ""} onClick={() => setFiltro("")} label={`Todos${stats ? ` (${stats.total})` : ""}`} />
        {ESTADOS.map((e) => (
          <Chip
            key={e.key}
            active={filtro === e.key}
            onClick={() => setFiltro(e.key)}
            label={`${e.label}${stats ? ` (${stats.porEstado[e.key] ?? 0})` : ""}`}
          />
        ))}
      </div>

      {loading ? (
        <div className="grid place-items-center py-16 text-cica-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="glass px-4 py-10 text-center text-sm text-cica-muted">
          No hay tickets {filtro ? "en este estado" : "todavía"}. Cuando un cliente reporte algo por Cica, aparecerá aquí.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => setSel(t)}
              className="glass p-4 text-left transition-colors hover:border-cica-gold/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-cica-gold">{t.codigo}</span>
                    <span className="rounded bg-cica-border/50 px-1.5 py-0.5 text-[10px] text-cica-silver">
                      {CAT_LABEL[t.categoria] || t.categoria}
                    </span>
                    {t.origen === "asistente" && (
                      <span className="rounded bg-cica-gold/15 px-1.5 py-0.5 text-[10px] text-cica-gold">Cica</span>
                    )}
                    {t.clienteId && <span className="rounded bg-cica-steelLight/15 px-1.5 py-0.5 text-[10px] text-cica-steelLight">cliente</span>}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{t.asunto}</div>
                  <div className="mt-0.5 text-xs text-cica-muted line-clamp-2">{t.descripcion}</div>
                  {t.contacto && <div className="mt-1 text-[11px] text-cica-steelLight">📞 {t.contacto}</div>}
                  <div className="mt-1 text-[10px] text-cica-muted">{new Date(t.creadoEn).toLocaleString("es-CO")}</div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${ESTADOS.find((e) => e.key === t.estado)?.color ?? "text-cica-muted"}`}>
                  {ESTADOS.find((e) => e.key === t.estado)?.label ?? t.estado}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {sel && (
        <TicketDrawer
          ticket={sel}
          onClose={() => setSel(null)}
          onEstado={(estado) => cambiarEstado(sel.id, estado)}
          onVerEnMapa={onVerEnMapa}
        />
      )}
    </div>
  );
}

/* ===================== Drawer de detalle ===================== */
function TicketDrawer({
  ticket,
  onClose,
  onEstado,
  onVerEnMapa,
}: {
  ticket: Ticket;
  onClose: () => void;
  onEstado: (estado: string) => void;
  onVerEnMapa?: (lng: number, lat: number) => void;
}) {
  const [c360, setC360] = useState<Cliente360 | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket.clienteId) return;
    setLoading(true);
    setErr(null);
    getCliente360(ticket.clienteId)
      .then(setC360)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [ticket.clienteId]);

  const lat = c360?.ubicacion.lat ?? null;
  const lng = c360?.ubicacion.lng ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-cica-border/70 bg-cica-navy/95 backdrop-blur-xl">
        {/* Encabezado */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-cica-border/60 bg-cica-navy/95 px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-cica-gold">{ticket.codigo}</div>
            <div className="truncate text-sm font-bold text-white">{ticket.asunto}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-cica-muted hover:bg-cica-border/40 hover:text-white">✕</button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Ticket */}
          <Section title="Solicitud">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-cica-border/50 px-1.5 py-0.5 text-[10px] text-cica-silver">{CAT_LABEL[ticket.categoria] || ticket.categoria}</span>
              {ticket.origen === "asistente" && <span className="rounded bg-cica-gold/15 px-1.5 py-0.5 text-[10px] text-cica-gold">Cica</span>}
              <select
                value={ticket.estado}
                onChange={(e) => onEstado(e.target.value)}
                className="ml-auto rounded-lg border border-cica-border bg-cica-navy/80 px-2 py-1 text-xs text-cica-silver outline-none focus:border-cica-gold"
              >
                {ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </div>
            <p className="mt-2 text-xs text-cica-silver">{ticket.descripcion}</p>
            {ticket.contacto && <div className="mt-1 text-[11px] text-cica-steelLight">📞 {ticket.contacto}</div>}
            <div className="mt-1 text-[10px] text-cica-muted">{new Date(ticket.creadoEn).toLocaleString("es-CO")}</div>
          </Section>

          {!ticket.clienteId && (
            <div className="rounded-lg border border-cica-border/40 bg-cica-navy/40 px-3 py-3 text-xs text-cica-muted">
              Este ticket no está ligado a un cliente registrado. Contacto: {ticket.contacto || "no indicado"}.
            </div>
          )}

          {loading && (
            <div className="grid place-items-center py-8 text-cica-muted">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
            </div>
          )}
          {err && <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}

          {c360 && (
            <>
              {/* Cliente */}
              <Section title="Cliente">
                <Row k="Nombre" v={c360.cliente.nombre} />
                <Row k="Documento" v={`${c360.cliente.tipoDocumento} ${c360.cliente.documento}`} />
                <Row k="Teléfono" v={c360.cliente.telefonoMovil || c360.cliente.telefonoFijo || "—"} />
                <Row k="Email" v={c360.cliente.email || "—"} />
                <Row k="Estado" v={c360.cliente.estado} accent={c360.cliente.estado === "activo" ? "text-status-ftth" : "text-status-parcial"} />
              </Section>

              {/* Ubicación + Mapa */}
              <Section title="Ubicación">
                <div className="text-xs text-cica-silver">{c360.ubicacion.direccion}</div>
                <div className="text-[11px] text-cica-muted">
                  {[c360.ubicacion.barrio, c360.ubicacion.comuna, c360.ubicacion.ciudad].filter(Boolean).join(" · ")}
                  {c360.ubicacion.estrato != null ? ` · Estrato ${c360.ubicacion.estrato}` : ""}
                </div>
                {c360.ubicacion.referencias && <div className="mt-1 text-[11px] italic text-cica-muted">{c360.ubicacion.referencias}</div>}
                <button
                  onClick={() => lat != null && lng != null && onVerEnMapa?.(lng, lat)}
                  disabled={lat == null || lng == null || !onVerEnMapa}
                  className="mt-3 flex items-center gap-2 rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-3 py-2 text-xs font-bold text-cica-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>
                  Mapa
                </button>
                {(lat == null || lng == null) && <div className="mt-1 text-[10px] text-cica-muted">Este punto no tiene coordenadas registradas.</div>}
              </Section>

              {/* Servicio */}
              <Section title="Servicio">
                <Row k="Plan" v={c360.servicio.plan} />
                <Row k="Estado" v={c360.servicio.estadoServicio} accent={c360.servicio.estadoServicio === "activo" ? "text-status-ftth" : "text-status-parcial"} />
                <Row k="Tecnología" v={c360.servicio.tecnologia} />
                <Row k="Velocidad" v={c360.servicio.velocidadBajada ? `${c360.servicio.velocidadBajada}/${c360.servicio.velocidadSubida ?? "—"} Mbps` : "—"} />
                <Row k="Tarifa" v={money(c360.servicio.tarifa)} />
                <Row k="Saldo" v={money(c360.servicio.saldo)} accent={c360.servicio.saldo > 0 ? "text-status-sin" : "text-cica-silver"} />
              </Section>

              {/* Equipos de red que comprometen su servicio */}
              <Section title="Red — equipos que comprometen el servicio">
                <Row k="ONU (cliente)" v={c360.red.onu.onuSerial || "—"} />
                {c360.red.onu.puerto != null && <Row k="Puerto" v={`#${c360.red.onu.puerto}`} />}
                {c360.servicio.ip && <Row k="IP" v={c360.servicio.ip} />}
                {c360.red.nap ? (
                  <>
                    <div className="mt-2 rounded-lg border border-cica-border/40 bg-cica-navy/40 p-2">
                      <div className="text-[11px] font-semibold text-cica-silver">{c360.red.nap.tipo} {c360.red.nap.nombre}</div>
                      {c360.red.nap.direccion && <div className="text-[10px] text-cica-muted">{c360.red.nap.direccion}</div>}
                      {c360.red.nap.capacidad && (
                        <div className="mt-1 text-[10px]">
                          Capacidad: <b className={semColor(c360.red.nap.capacidad.semaforo)}>{c360.red.nap.capacidad.usados}/{c360.red.nap.capacidad.total}</b> ({c360.red.nap.capacidad.libres} libres)
                        </div>
                      )}
                    </div>
                    {c360.red.cadena.length > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-cica-muted">Ruta hasta el POP</div>
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="rounded bg-cica-steelLight/15 px-1.5 py-0.5 text-cica-steelLight">ONU</span>
                          {c360.red.cadena.map((n) => (
                            <span key={n.id} className="flex items-center gap-1">
                              <span className="text-cica-muted">→</span>
                              <span className="rounded bg-cica-border/50 px-1.5 py-0.5 text-cica-silver">{n.tipo} {n.nombre}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {c360.red.vecinos && (
                      <div className="mt-2 text-[11px] text-cica-muted">
                        En esta NAP: {c360.red.vecinos.total} cliente(s)
                        {c360.red.vecinos.conTicketAbierto > 0 ? <span className="text-status-sin"> · {c360.red.vecinos.conTicketAbierto} con ticket abierto</span> : ""}
                        {c360.red.vecinos.conFalla > 0 ? <span className="text-status-parcial"> · {c360.red.vecinos.conFalla} con falla</span> : ""}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-1 text-[11px] text-cica-muted">Sin NAP asignada en el inventario de red.</div>
                )}
              </Section>

              {/* Alertas */}
              {c360.alertas.length > 0 && (
                <Section title="Alertas">
                  <div className="flex flex-col gap-1.5">
                    {c360.alertas.map((a, i) => (
                      <div key={i} className={`rounded-lg px-2 py-1.5 text-[11px] ${a.nivel === "alta" ? "bg-status-sin/10 text-status-sin" : a.nivel === "media" ? "bg-cica-amber/10 text-cica-amber" : "bg-cica-border/30 text-cica-muted"}`}>
                        {a.mensaje}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass p-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-cica-muted">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-xs">
      <span className="text-cica-muted">{k}</span>
      <span className={`text-right font-medium ${accent ?? "text-cica-silver"}`}>{v}</span>
    </div>
  );
}

function semColor(s: string): string {
  return s === "rojo" ? "text-status-sin" : s === "amarillo" ? "text-cica-amber" : "text-status-ftth";
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-gradient-to-r from-cica-amber to-cica-gold text-cica-black"
          : "border border-cica-border/70 text-cica-muted hover:text-cica-silver"
      }`}
    >
      {label}
    </button>
  );
}
