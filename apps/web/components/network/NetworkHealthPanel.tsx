"use client";

import { useCallback, useEffect, useState } from "react";
import {
  engineOverview,
  engineCriticality,
  type EngineOverview,
  type CriticalityNode,
  type FailureSeverity,
  type InfraBundle,
} from "../../lib/api";

const SEVERITY: Record<FailureSeverity, { color: string; label: string }> = {
  baja: { color: "#22E0A1", label: "Baja" },
  media: { color: "#FFB02E", label: "Media" },
  alta: { color: "#FF8A3D", label: "Alta" },
  critica: { color: "#FF4D6D", label: "Crítica" },
};

const cop = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

/**
 * Panel de Salud de Red (Operación) — vista de operador del Gemelo Digital.
 * Resume el modelo de red (nodos, fibra, islas, planta huérfana) y rankea los
 * Puntos Únicos de Falla (SPOF): activos cuya caída deja más clientes e ingresos
 * sin servicio. Permite saltar al nodo crítico en el mapa con un clic.
 */
export default function NetworkHealthPanel({
  infra,
  onFocus,
}: {
  infra: InfraBundle | null;
  onFocus: (lng: number, lat: number, color?: string) => void;
}) {
  const [overview, setOverview] = useState<EngineOverview | null>(null);
  const [spof, setSpof] = useState<CriticalityNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [ov, cr] = await Promise.all([engineOverview(), engineCriticality(8)]);
      setOverview(ov);
      setSpof(cr);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Recarga al montar y cuando cambia el inventario (nº de activos/fibras).
  useEffect(() => { load(); }, [load, infra?.stats.activos, infra?.stats.fibras]);

  const coordOf = (id: string): [number, number] | null => {
    const f = (infra?.assets.features as any[])?.find((x) => x.properties.id === id);
    return f ? (f.geometry.coordinates as [number, number]) : null;
  };

  return (
    <div className="glass animate-fadeUp p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-cica-muted">Salud de red · motor</span>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-cica-border/60 px-2 py-0.5 text-[10px] font-semibold text-cica-silver hover:bg-cica-border/40 disabled:opacity-50"
        >
          {loading ? "…" : "↻ Recalcular"}
        </button>
      </div>

      {err && (
        <div className="mb-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-[11px] text-status-sin">{err}</div>
      )}

      {/* Resumen del modelo unificado */}
      {overview && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Chip label="Nodos" value={overview.nodos} />
          <Chip label="Aristas" value={overview.aristas} />
          <Chip label="Fibras" value={overview.fibras} />
          <Chip label="Islas" value={overview.islas} hint={overview.islas > 1 ? "red fragmentada" : "red unida"} />
          <Chip
            label="Sin raíz"
            value={overview.islasSinRaiz}
            color={overview.islasSinRaiz > 0 ? "#FF4D6D" : undefined}
            hint={overview.islasSinRaiz > 0 ? "planta sin OLT/POP" : "todo enlazado"}
          />
        </div>
      )}

      {/* Ranking de criticidad (SPOF) */}
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-cica-muted">
        Puntos críticos de falla
      </div>

      {!spof || spof.length === 0 ? (
        <p className="text-[11px] text-cica-muted">
          {loading ? "Analizando topología…" : "Aún no hay clientes conectados para evaluar el impacto de una falla."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {spof.map((n, i) => {
            const sev = SEVERITY[n.severidad];
            const coord = coordOf(n.id);
            return (
              <button
                key={n.id}
                onClick={() => coord && onFocus(coord[0], coord[1], sev.color)}
                disabled={!coord}
                className="group flex items-center gap-2.5 rounded-lg border border-cica-border/50 bg-cica-navy/30 px-3 py-2 text-left transition-colors hover:border-cica-gold/40 disabled:cursor-default"
                title={coord ? "Centrar en el mapa" : undefined}
              >
                <span className="text-[10px] font-bold text-cica-muted">{i + 1}</span>
                <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: sev.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-bold text-cica-silver">{n.nombre}</span>
                    <span className="text-[9px] text-cica-muted">{n.tipo}</span>
                  </div>
                  <div className="text-[10px] text-cica-muted">
                    {n.clientesAfectados} clientes · {cop(n.ingresosEnRiesgo)} en riesgo
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                  style={{ color: sev.color, background: `${sev.color}1A` }}
                >
                  {sev.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-cica-muted">
        Ordena los activos cuya caída afectaría a más clientes. Prioriza aquí la redundancia y el monitoreo.
      </p>
    </div>
  );
}

function Chip({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-cica-border/50 bg-cica-navy/30 px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-wide text-cica-muted">{label}</div>
      <div className="text-[15px] font-extrabold leading-tight" style={{ color: color || "#E6EDF7" }}>{value}</div>
      {hint && <div className="text-[8px] text-cica-muted">{hint}</div>}
    </div>
  );
}
