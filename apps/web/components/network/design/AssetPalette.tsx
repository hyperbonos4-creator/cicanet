"use client";

// Paleta de dispositivos profesional (estilo Cisco Packet Tracer): expone TODOS
// los tipos de activo que soporta el dominio, agrupados por capa de red, para
// colocarlos en el mapa con un clic. Reemplaza la lista fija de 4 tipos.

export type DeviceMeta = {
  tipo: string;
  label: string;
  color: string;
  icon: string;
  hint: string;
};

export const DEVICE_META: Record<string, DeviceMeta> = {
  POP: { tipo: "POP", label: "POP / Central", color: "#22D3EE", icon: "🏢", hint: "Punto de presencia / cabecera" },
  OLT: { tipo: "OLT", label: "OLT", color: "#3B82F6", icon: "🛰️", hint: "Terminal de línea óptica (GPON)" },
  Switch: { tipo: "Switch", label: "Switch", color: "#6366F1", icon: "🔀", hint: "Conmutador de red" },
  Router: { tipo: "Router", label: "Router", color: "#8B5CF6", icon: "📶", hint: "Enrutador / borde" },
  NAP: { tipo: "NAP", label: "NAP / Caja", color: "#22E0A1", icon: "📦", hint: "Caja de distribución con puertos" },
  Splitter: { tipo: "Splitter", label: "Splitter", color: "#38BDF8", icon: "🔱", hint: "Divisor óptico 1:N" },
  Empalme: { tipo: "Empalme", label: "Empalme", color: "#A3E635", icon: "🔗", hint: "Fusión / mufa" },
  Poste: { tipo: "Poste", label: "Poste", color: "#D6A35C", icon: "🗼", hint: "Soporte de planta externa" },
  ONU: { tipo: "ONU", label: "ONU / Módem", color: "#94A3B8", icon: "🏠", hint: "Equipo en casa del cliente" },
  Cliente: { tipo: "Cliente", label: "Cliente", color: "#38BDF8", icon: "👤", hint: "Suscriptor / acometida" },
  UPS: { tipo: "UPS", label: "UPS", color: "#FBBF24", icon: "🔋", hint: "Respaldo de energía" },
  Servidor: { tipo: "Servidor", label: "Servidor", color: "#FBBF24", icon: "🖥️", hint: "Servidor / NMS" },
  Camara: { tipo: "Camara", label: "Cámara", color: "#F472B6", icon: "📷", hint: "Videovigilancia" },
};

const DEVICE_GROUPS: { group: string; items: string[] }[] = [
  { group: "Cabecera / Core", items: ["POP", "OLT", "Switch", "Router"] },
  { group: "Distribución", items: ["NAP", "Splitter", "Empalme", "Poste"] },
  { group: "Cliente", items: ["ONU", "Cliente"] },
  { group: "Energía y otros", items: ["UPS", "Servidor", "Camara"] },
];

/**
 * Paleta de colocación. `onStartPlace(tipo)` arma el modo "colocar" y el
 * siguiente clic en el mapa ubica el activo. Mientras hay un tipo activo,
 * muestra el banner para terminar.
 */
export default function AssetPalette({
  placeTipo,
  onStartPlace,
  onStopPlace,
  compact = false,
}: {
  placeTipo: string | null;
  onStartPlace: (tipo: string) => void;
  onStopPlace: () => void;
  compact?: boolean;
}) {
  if (placeTipo) {
    const m = DEVICE_META[placeTipo];
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-cica-gold/40 bg-cica-gold/10 px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 text-cica-silver">
          <span>{m?.icon ?? "📍"}</span>
          Clic en el mapa para ubicar <strong className="text-cica-gold">{m?.label ?? placeTipo}</strong>…
        </span>
        <button onClick={onStopPlace} className="shrink-0 font-semibold text-cica-muted hover:text-status-sin">
          Terminar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {DEVICE_GROUPS.map((g) => (
        <div key={g.group}>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-cica-muted">{g.group}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((t) => {
              const m = DEVICE_META[t];
              return (
                <button
                  key={t}
                  onClick={() => onStartPlace(t)}
                  title={m.hint}
                  className="group flex items-center gap-2 rounded-lg border border-cica-border bg-cica-navy/60 px-2 py-2 text-left transition-colors hover:border-cica-gold/50 hover:bg-cica-navy"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px]"
                    style={{ background: `${m.color}1A`, boxShadow: `inset 0 0 0 1px ${m.color}55` }}
                  >
                    {m.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-cica-silver">{m.label}</span>
                    {!compact && <span className="block truncate text-[9px] text-cica-muted">{m.hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
