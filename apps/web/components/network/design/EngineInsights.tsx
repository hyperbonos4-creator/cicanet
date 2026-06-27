"use client";

import { useCallback, useEffect, useState } from "react";
import {
  engineOptical,
  engineSimulateFailure,
  type OpticalBudget,
  type FailureImpact,
  type FailureSeverity,
} from "../../../lib/api";

const HEALTH = {
  verde: { color: "#22E0A1", label: "Saludable" },
  amarillo: { color: "#FFB02E", label: "Sin margen" },
  rojo: { color: "#FF4D6D", label: "Fuera de rango" },
} as const;

const SEVERITY: Record<FailureSeverity, { color: string; label: string }> = {
  baja: { color: "#22E0A1", label: "Baja" },
  media: { color: "#FFB02E", label: "Media" },
  alta: { color: "#FF8A3D", label: "Alta" },
  critica: { color: "#FF4D6D", label: "Crítica" },
};

const ELEM_COLOR: Record<string, string> = {
  fibra: "#6366F1",
  splitter: "#38BDF8",
  empalme: "#A3E635",
  conector: "#D6A35C",
};

const cop = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

/**
 * Panel de Ingeniería del Gemelo Digital (Network Engine). Muestra el
 * presupuesto óptico real (dB OLT→cliente) y permite simular la caída del nodo
 * para ver el impacto aguas abajo (clientes e ingresos en riesgo). Es la capa
 * "nivel operador" que valida la red más allá de dibujarla.
 */
export default function EngineInsights({ assetId, onImpact, onSimEvent }: { assetId: string | null; onImpact?: (ids: string[]) => void; onSimEvent?: (impact: FailureImpact) => void }) {
  const [budget, setBudget] = useState<OpticalBudget | null>(null);
  const [loadingB, setLoadingB] = useState(false);
  const [errB, setErrB] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [impact, setImpact] = useState<FailureImpact | null>(null);
  const [loadingS, setLoadingS] = useState(false);

  useEffect(() => {
    setBudget(null);
    setImpact(null);
    setErrB(null);
    setShowBreakdown(false);
    onImpact?.([]); // limpia la cascada del mapa al cambiar de activo
    if (!assetId) return;
    let cancelled = false;
    setLoadingB(true);
    engineOptical(assetId)
      .then((b) => { if (!cancelled) setBudget(b); })
      .catch((e: any) => { if (!cancelled) setErrB(e.message); })
      .finally(() => { if (!cancelled) setLoadingB(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  const simulate = useCallback(async () => {
    if (!assetId || loadingS) return;
    setLoadingS(true);
    try {
      const r = await engineSimulateFailure(assetId);
      setImpact(r);
      onImpact?.(r.activosAfectados); // pinta la cascada en el mapa
      onSimEvent?.(r); // registra el evento en el timeline
    }
    catch { /* silencioso: el panel sigue usable */ }
    finally { setLoadingS(false); }
  }, [assetId, loadingS, onImpact, onSimEvent]);

  if (!assetId) return null;

  const hasChain = (budget?.cadena?.length ?? 0) > 1;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Presupuesto óptico ── */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-cica-muted">
            Presupuesto óptico
          </span>
          {budget && (
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: HEALTH[budget.salud].color, background: `${HEALTH[budget.salud].color}1A` }}
            >
              {HEALTH[budget.salud].label}
            </span>
          )}
        </div>

        {loadingB && <div className="text-[11px] text-cica-muted">Calculando enlace óptico…</div>}
        {errB && !loadingB && (
          <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-[11px] text-status-sin">{errB}</div>
        )}

        {budget && !loadingB && !hasChain && (
          <p className="text-[11px] text-cica-muted">
            Este nodo es raíz (sin cadena hacia un OLT/POP). Conéctalo a la red para calcular su presupuesto óptico.
          </p>
        )}

        {budget && !loadingB && hasChain && (
          <div className="flex flex-col gap-2.5">
            {/* Lecturas clave */}
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Margen" value={`${budget.margenDb} dB`} color={HEALTH[budget.salud].color} />
              <Metric label="Potencia Rx" value={`${budget.potenciaRxDbm} dBm`} />
              <Metric label="Pérdida" value={`${budget.perdidaTotalDb} dB`} />
            </div>

            {/* Barra: pérdida consumida vs presupuesto disponible */}
            <div>
              <div className="mb-1 flex items-center justify-between text-[9px] text-cica-muted">
                <span>Consumo del presupuesto</span>
                <span>{budget.perdidaTotalDb} / {budget.presupuestoDb} dB</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-cica-black/50">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (budget.perdidaTotalDb / Math.max(1, budget.presupuestoDb)) * 100)}%`,
                    background: HEALTH[budget.salud].color,
                    boxShadow: `0 0 8px ${HEALTH[budget.salud].color}`,
                  }}
                />
              </div>
            </div>

            {/* Desglose plegable */}
            <button
              onClick={() => setShowBreakdown((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-semibold text-cica-glow hover:text-cica-gold"
            >
              {showBreakdown ? "▾" : "▸"} Desglose de pérdidas ({budget.desglose.length})
            </button>
            {showBreakdown && (
              <div className="flex flex-col gap-1">
                {budget.desglose.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ELEM_COLOR[d.tipo] || "#8B96AC" }} />
                    <span className="truncate text-cica-silver">{d.etiqueta}</span>
                    <span className="ml-auto font-mono text-cica-muted">{d.db} dB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Simulación de falla ── */}
      <section className="border-t border-cica-border/40 pt-3">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-cica-muted">
          Simulación de falla
        </div>

        {!impact ? (
          <button
            onClick={simulate}
            disabled={loadingS}
            className="w-full rounded-lg border border-status-sin/40 bg-status-sin/5 px-3 py-2 text-[11px] font-semibold text-status-sin transition-colors hover:bg-status-sin/15 disabled:opacity-50"
          >
            {loadingS ? "Simulando…" : "⚠ Simular caída de este nodo"}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-cica-silver">Severidad del impacto</span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                style={{ color: SEVERITY[impact.severidad].color, background: `${SEVERITY[impact.severidad].color}1A` }}
              >
                {SEVERITY[impact.severidad].label}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Clientes" value={String(impact.clientesAfectados.length)} color={SEVERITY[impact.severidad].color} />
              <Metric label="NAPs" value={String(impact.napsAfectadas)} />
              <Metric label="Activos" value={String(impact.activosAfectados.length)} />
            </div>
            <div className="rounded-lg border border-cica-border/50 bg-cica-navy/30 px-3 py-2">
              <div className="text-[9px] uppercase tracking-wide text-cica-muted">Ingresos mensuales en riesgo</div>
              <div className="text-sm font-extrabold" style={{ color: SEVERITY[impact.severidad].color }}>
                {cop(impact.ingresosEnRiesgo)}
              </div>
            </div>
            <button
              onClick={() => { setImpact(null); onImpact?.([]); }}
              className="self-start text-[10px] text-cica-muted hover:text-white"
            >
              Limpiar simulación
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-cica-border/50 bg-cica-navy/30 px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-wide text-cica-muted">{label}</div>
      <div className="text-[13px] font-extrabold leading-tight" style={{ color: color || "#E6EDF7" }}>
        {value}
      </div>
    </div>
  );
}
