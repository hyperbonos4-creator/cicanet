"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listTickets,
  ticketStats,
  updateTicketEstado,
  type Ticket,
  type TicketStats,
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

/** Bandeja de tickets de soporte. Muestra lo que crea el asistente Cica y el staff. */
export default function TicketsPanel() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [filtro, setFiltro] = useState<string>("");
  const [loading, setLoading] = useState(true);

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
      </p>

      {/* KPIs / filtros */}
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
            <div key={t.id} className="glass p-4">
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
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{t.asunto}</div>
                  <div className="mt-0.5 text-xs text-cica-muted line-clamp-2">{t.descripcion}</div>
                  {t.contacto && <div className="mt-1 text-[11px] text-cica-steelLight">📞 {t.contacto}</div>}
                  <div className="mt-1 text-[10px] text-cica-muted">
                    {new Date(t.creadoEn).toLocaleString("es-CO")}
                  </div>
                </div>
                <select
                  value={t.estado}
                  onChange={(e) => cambiarEstado(t.id, e.target.value)}
                  className="shrink-0 rounded-lg border border-cica-border bg-cica-navy/80 px-2 py-1.5 text-xs text-cica-silver outline-none focus:border-cica-gold"
                >
                  {ESTADOS.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
