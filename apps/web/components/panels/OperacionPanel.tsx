"use client";

import { useMemo } from "react";
import type { CoverageResult, InfraBundle } from "../../lib/api";

type LayerKey = "barrios" | "cobertura" | "fibra" | "nodos" | "clientes";

export default function OperacionPanel({
  infra,
  visibility,
  onToggle,
  coverage,
  checking,
}: {
  infra: InfraBundle | null;
  visibility: Record<LayerKey, boolean>;
  onToggle: (k: LayerKey) => void;
  coverage: CoverageResult | null;
  checking: boolean;
}) {
  const statCards = useMemo(() => {
    const assets = infra?.assets.features || [];
    const count = (t: string) => assets.filter((f: any) => f.properties.tipo === t).length;
    const clientes = count("Cliente");
    return [
      { label: "Equipos en red", value: String(infra?.stats.activos ?? 0), sub: "activos registrados", accent: "text-cica-gold" },
      { label: "Fibra tendida", value: `${infra?.stats.metrosFibra ?? 0} m`, sub: `${infra?.stats.fibras ?? 0} tramos`, accent: "text-cica-glow" },
      { label: "NAP / CTO", value: String(count("NAP") + count("CTO")), sub: "puntos de acceso", accent: "text-status-ftth" },
      { label: "Clientes", value: String(clientes), sub: "conectados a la red", accent: "text-cica-steelLight" },
    ];
  }, [infra]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="glass animate-fadeUp px-4 py-3.5">
            <div className={`text-2xl font-extrabold ${s.accent}`}>{s.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-cica-silver">{s.label}</div>
            <div className="text-[10px] text-cica-muted">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="glass animate-fadeUp p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-cica-muted">Capas del mapa</div>
        <button onClick={() => onToggle("barrios")} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-cica-silver transition-colors hover:bg-cica-border/40">
          <span>Barrios (zona de servicio)</span>
          <span className={`relative h-5 w-9 rounded-full transition-colors ${visibility.barrios ? "bg-gradient-to-r from-cica-amber to-cica-gold" : "bg-cica-border"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${visibility.barrios ? "left-[18px]" : "left-0.5"}`} />
          </span>
        </button>
        <p className="mt-2 text-[10px] leading-relaxed text-cica-muted">
          El mapa muestra únicamente tu infraestructura real (equipos y fibra que registras en Infraestructura). Sin datos de demostración.
        </p>
      </div>

      <div className="glass animate-fadeUp p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-cica-muted">Consulta rápida (clic en el mapa)</div>
        {checking ? (
          <div className="text-xs text-cica-muted">Consultando punto…</div>
        ) : coverage ? (
          <CoverageResultView coverage={coverage} />
        ) : (
          <div className="text-xs text-cica-muted">Haz clic en cualquier punto del mapa para verificar si hay cobertura en esa ubicación.</div>
        )}
      </div>
    </div>
  );
}

export function CoverageResultView({ coverage }: { coverage: CoverageResult }) {
  return (
    <div>
      <div className={`text-sm font-bold ${coverage.cobertura ? (coverage.estado === "ftth" ? "text-status-ftth" : "text-status-parcial") : coverage.estado === "fuera_de_zona" ? "text-cica-muted" : "text-status-sin"}`}>
        {coverage.cobertura
          ? coverage.estado === "ftth"
            ? "✓ FTTH disponible"
            : "▲ Cobertura parcial"
          : coverage.estado === "fuera_de_zona"
          ? "○ Fuera del barrio"
          : "✕ Sin cobertura aún"}
      </div>
      <div className="mt-0.5 text-[11px] text-cica-muted">{coverage.mensaje}</div>
      {coverage.tecnologia && <div className="mt-0.5 text-[11px] text-cica-muted">{coverage.tecnologia}</div>}
      {coverage.napCercano && (
        <div className="mt-2 rounded-lg bg-cica-navy/60 px-3 py-2 text-[11px] text-cica-silver">
          NAP más cercano: <strong>{coverage.napCercano.nombre}</strong>
          <br />
          <span className="text-cica-muted">{coverage.napCercano.metros} m · {coverage.napCercano.libres} puertos libres</span>
        </div>
      )}
    </div>
  );
}
