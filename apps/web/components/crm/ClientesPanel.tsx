"use client";

import { useEffect, useRef, useState } from "react";
import { geocode, type GeocodeCandidate, type CoverageResult } from "../../lib/api";
import { CoverageResultView } from "../network/OperacionPanel";

export default function ClientesPanel({
  onCheckAddress,
  coverage,
  checking,
  pinAddress,
  pin,
}: {
  onCheckAddress: (lng: number, lat: number, label: string) => void;
  coverage: CoverageResult | null;
  checking: boolean;
  pinAddress?: string | null;
  pin?: { lng: number; lat: number } | null;
}) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const reqId = useRef(0);
  const lastTerm = useRef("");

  async function runSearch(term: string) {
    const t = term.trim();
    if (t.length < 4) return;
    lastTerm.current = t;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await geocode(t);
      if (id !== reqId.current) return; // llegó una búsqueda más nueva
      setCandidates(res);
      if (res.length === 0) setError("Sin coincidencias. Prueba agregando el barrio o la carrera.");
    } catch (err: any) {
      if (id === reqId.current) setError(err.message || "No se pudo geocodificar");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // Búsqueda en tiempo real (debounce mientras escribes)
  useEffect(() => {
    const t = q.trim();
    if (t.length < 4 || t === lastTerm.current) return;
    const h = setTimeout(() => runSearch(t), 650);
    return () => clearTimeout(h);
  }, [q]);

  function pick(c: GeocodeCandidate) {
    setSelected(c.displayName);
    onCheckAddress(c.lng, c.lat, c.displayName);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="glass animate-fadeUp p-4">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-cica-muted">¿Tenemos cobertura?</div>
        <p className="mb-3 text-[11px] leading-relaxed text-cica-muted">
          Escribe la dirección del cliente y buscamos en tiempo real (OpenStreetMap). También puedes hacer clic directo en el mapa para ubicar el punto exacto.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); runSearch(q); }} className="flex flex-col gap-2">
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Calle 124 #43-5, Medellín"
              className="w-full rounded-xl border border-cica-border bg-cica-navy/80 px-3 py-2.5 pr-9 text-sm text-cica-silver outline-none transition-colors focus:border-cica-gold"
            />
            {loading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <span className="block h-4 w-4 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
              </span>
            )}
          </div>
          <button type="submit" disabled={loading || q.trim().length < 4} className="btn-cica w-full disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? "Buscando…" : "Verificar cobertura"}
          </button>
        </form>
        {error && <div className="mt-2 rounded-lg border border-status-parcial/40 bg-status-parcial/10 px-3 py-2 text-xs text-status-parcial">{error}</div>}
      </div>

      {candidates && candidates.length > 0 && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-cica-muted">Resultados ({candidates.length})</div>
          <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
            {candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => pick(c)}
                className={`rounded-lg border px-3 py-2 text-left text-[11px] leading-snug transition-colors ${
                  selected === c.displayName
                    ? "border-cica-gold/60 bg-cica-gold/10 text-cica-silver"
                    : "border-cica-border/60 bg-cica-navy/40 text-cica-silver hover:border-cica-gold/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-2">{c.displayName}</span>
                </div>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold ${c.dentroDelBarrio ? "bg-status-ftth/15 text-status-ftth" : "bg-cica-border/60 text-cica-muted"}`}>
                  {c.dentroDelBarrio ? "Dentro de tu zona de servicio" : "Fuera de tu zona de servicio"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {pin && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cica-gold">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-cica-gold shadow-glow" />
            Ubicación seleccionada
          </div>
          <p className="text-[11px] leading-snug text-cica-silver">{pinAddress || "Resolviendo dirección…"}</p>
          <p className="mt-1 text-[10px] text-cica-muted">{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>
          <p className="mt-1.5 text-[10px] text-cica-muted">🖐️ Arrastra el pin en el mapa para afinarlo a la casa exacta.</p>
        </div>
      )}

      {(checking || coverage) && (
        <div className="glass animate-fadeUp p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-cica-muted">Resultado de cobertura</div>
          {checking ? <div className="text-xs text-cica-muted">Consultando punto…</div> : coverage ? <CoverageResultView coverage={coverage} /> : null}
        </div>
      )}
    </div>
  );
}
