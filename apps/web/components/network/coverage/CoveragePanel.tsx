"use client";

import { useMemo } from "react";
import type { NapRecord, ZoneRecord, ClienteStats } from "../../../lib/api";

const money = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

const SEM_COLOR = { verde: "#22E0A1", amarillo: "#FFB02E", rojo: "#FF4D6D" } as const;

/** Mismos umbrales que el dominio (connectivity.portSemaphore). */
function semaforo(total: number, usados: number): "verde" | "amarillo" | "rojo" {
  if (total <= 0) return "rojo";
  const libres = total - usados;
  if (libres <= 0) return "rojo";
  return usados / total >= 0.75 ? "amarillo" : "verde";
}

/**
 * Inteligencia comercial geoespacial (modo Cobertura). A diferencia del Diseño
 * (ingeniería) y la Operación (monitoreo), aquí se mira la red como negocio:
 * capacidad vendible, dónde vender hoy y dónde se necesita expansión.
 */
export default function CoveragePanel({
  naps,
  zones,
  cli,
  onFocus,
  heatmapOn,
  onToggleHeatmap,
  onShowReach,
}: {
  naps: NapRecord[];
  zones: ZoneRecord[];
  cli: ClienteStats | null;
  onFocus: (lng: number, lat: number, color?: string) => void;
  heatmapOn: boolean;
  onToggleHeatmap: () => void;
  onShowReach: (napId: string, metros?: number) => void;
}) {
  const m = useMemo(() => {
    const total = naps.reduce((s, n) => s + (n.puertos_total || 0), 0);
    const usados = naps.reduce((s, n) => s + (n.puertos_usados || 0), 0);
    const libres = Math.max(0, total - usados);
    const usoPct = total > 0 ? Math.round((usados / total) * 100) : null;

    const conSem = naps.map((n) => ({ ...n, libres: Math.max(0, (n.puertos_total || 0) - (n.puertos_usados || 0)), sem: semaforo(n.puertos_total || 0, n.puertos_usados || 0) }));
    const verde = conSem.filter((n) => n.sem === "verde").length;
    const amarillo = conSem.filter((n) => n.sem === "amarillo").length;
    const rojo = conSem.filter((n) => n.sem === "rojo").length;

    const vender = conSem.filter((n) => n.libres > 0).sort((a, b) => b.libres - a.libres).slice(0, 5);
    const expansion = conSem.filter((n) => n.libres <= 0).slice(0, 5);

    const activos = cli?.porServicio?.activo ?? 0;
    const arpu = activos > 0 && cli ? cli.ingresoMensual / activos : null;

    return { total, usados, libres, usoPct, verde, amarillo, rojo, vender, expansion, activos, arpu };
  }, [naps, cli]);

  const semTotal = m.verde + m.amarillo + m.rojo || 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Control del mapa de calor de densidad */}
      <div className="glass-soft flex items-center justify-between px-3 py-2">
        <div>
          <div className="text-[11px] font-bold text-cica-silver">Mapa de calor de densidad</div>
          <div className="text-[10px] text-cica-muted">Concentración de clientes en el mapa</div>
        </div>
        <button
          role="switch"
          aria-checked={heatmapOn}
          onClick={onToggleHeatmap}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${heatmapOn ? "bg-cica-gold/80" : "bg-cica-border"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${heatmapOn ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      {/* KPIs comerciales */}
      <div className="glass animate-fadeUp p-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Negocio de la red</div>
        <div className="grid grid-cols-2 gap-3 text-center">
          <Kpi label="Clientes activos" value={String(m.activos)} tone="ftth" />
          <Kpi label="Ingreso mensual" value={cli ? money(cli.ingresoMensual) : "—"} tone="gold" />
          <Kpi label="ARPU" value={m.arpu != null ? money(m.arpu) : "—"} tone="silver" />
          <Kpi label="Capacidad vendible" value={`${m.libres}`} tone={m.libres < 10 ? "sin" : "ftth"} sub="puertos libres" />
          <Kpi label="Uso de red" value={m.usoPct == null ? "—" : `${m.usoPct}%`} tone={m.usoPct != null && m.usoPct >= 80 ? "sin" : "steel"} />
          <Kpi label="Zonas de servicio" value={String(zones.length)} tone="glow" />
        </div>
      </div>

      {/* Semáforo de capacidad por NAP */}
      <div className="glass animate-fadeUp p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-cica-muted">Capacidad de NAPs</span>
          <span className="text-[10px] text-cica-muted">{naps.length} en total</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-cica-border">
          <div style={{ width: `${(m.verde / semTotal) * 100}%`, background: SEM_COLOR.verde }} />
          <div style={{ width: `${(m.amarillo / semTotal) * 100}%`, background: SEM_COLOR.amarillo }} />
          <div style={{ width: `${(m.rojo / semTotal) * 100}%`, background: SEM_COLOR.rojo }} />
        </div>
        <div className="mt-2 flex justify-between text-[10px]">
          <span className="text-status-ftth">● {m.verde} disponibles</span>
          <span className="text-status-parcial">● {m.amarillo} casi llenas</span>
          <span className="text-status-sin">● {m.rojo} saturadas</span>
        </div>
      </div>

      {/* Dónde vender ahora */}
      <div className="glass animate-fadeUp p-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Vender ahora · más capacidad libre</div>
        {m.vender.length === 0 ? (
          <p className="text-[11px] text-cica-muted">No hay NAPs con puertos libres. Toca expandir.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {m.vender.map((n) => (
              <div key={n.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-cica-border/30">
                <button onClick={() => onFocus(n.lng, n.lat, SEM_COLOR[n.sem])} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEM_COLOR[n.sem] }} />
                  <span className="truncate text-[11px] text-cica-silver">{n.nombre}</span>
                  <span className="ml-auto text-[11px] font-bold text-status-ftth">{n.libres} libres</span>
                </button>
                <button onClick={() => onShowReach(n.id)} title="Ver alcance de tendido por calles" className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-cica-glow hover:bg-cica-glow/15">◎</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Requiere expansión */}
      {m.expansion.length > 0 && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cica-muted">Requiere expansión · NAPs saturadas</div>
          <div className="flex flex-col gap-1">
            {m.expansion.map((n) => (
              <button key={n.id} onClick={() => onFocus(n.lng, n.lat, SEM_COLOR.rojo)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-cica-border/30">
                <span className="h-2 w-2 rounded-full" style={{ background: SEM_COLOR.rojo }} />
                <span className="truncate text-[11px] text-cica-silver">{n.nombre}</span>
                <span className="ml-auto text-[10px] text-status-sin">0 libres</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone: "gold" | "ftth" | "silver" | "glow" | "steel" | "sin"; sub?: string }) {
  const color: Record<string, string> = {
    gold: "text-cica-gold", ftth: "text-status-ftth", silver: "text-cica-silver",
    glow: "text-cica-glow", steel: "text-cica-steelLight", sin: "text-status-sin",
  };
  return (
    <div>
      <div className={`text-lg font-extrabold ${color[tone]}`}>{value}</div>
      <div className="text-[10px] font-semibold text-cica-silver">{label}</div>
      {sub && <div className="text-[9px] text-cica-muted">{sub}</div>}
    </div>
  );
}
