"use client";

import { NETWORK_MODES, type NetworkMode } from "./types";

/**
 * Selector de modo del módulo de Red (segmented control). Hace explícito que
 * Diseño / Operación / Cobertura son tres intenciones del mismo sistema, no tres
 * herramientas distintas. Es la pieza que resuelve el solapamiento Editor/Mapa.
 */
export default function NetworkModeSwitch({
  mode,
  onChange,
  canEdit,
}: {
  mode: NetworkMode;
  onChange: (m: NetworkMode) => void;
  canEdit: boolean;
}) {
  return (
    <div className="glass-soft flex items-center gap-1 rounded-xl p-1">
      {NETWORK_MODES.map((m) => {
        // El modo Diseño escribe en la red; sin permiso de edición se oculta.
        if (m.key === "design" && !canEdit) return null;
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            title={`${m.intent} · ${m.hint}`}
            className={`flex flex-1 flex-col items-center rounded-lg px-3 py-1.5 transition-all ${
              active
                ? "bg-gradient-to-br from-cica-amber/25 to-cica-gold/15 text-cica-gold"
                : "text-cica-muted hover:bg-cica-border/40 hover:text-cica-silver"
            }`}
          >
            <span className="text-[12px] font-bold leading-tight">{m.label}</span>
            <span className="text-[9px] font-medium leading-tight opacity-80">{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
