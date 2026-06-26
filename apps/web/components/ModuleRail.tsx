"use client";

import type { SessionUser } from "../lib/api";

export type ModuleKey = "operacion" | "clientes" | "infra";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  operador: "Operador NOC",
  tecnico: "Técnico",
};

const MODULES: { key: ModuleKey; label: string; icon: JSX.Element }[] = [
  {
    key: "operacion",
    label: "Operación",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 12h4l2 6 4-14 2 8h6" />
      </svg>
    ),
  },
  {
    key: "clientes",
    label: "Clientes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
      </svg>
    ),
  },
  {
    key: "infra",
    label: "Editor de Red",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 21V9" />
        <path d="M7 21V13" />
        <path d="M17 21V13" />
        <path d="M5 9l7-5 7 5" />
        <circle cx="12" cy="6.5" r="1" />
      </svg>
    ),
  },
];

export default function ModuleRail({
  module,
  onChange,
  user,
  onLogout,
}: {
  module: ModuleKey;
  onChange: (m: ModuleKey) => void;
  user: SessionUser | null;
  onLogout: () => void;
}) {
  return (
    <nav className="pointer-events-auto z-20 flex h-full w-[76px] flex-col items-center justify-between border-r border-cica-border/70 bg-cica-navy/80 py-4 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-6">
        <img src="/vx-emblem.svg" alt="VisionYX" width={44} height={44} className="h-11 w-11 rounded-full ring-1 ring-cica-steel/40 shadow-glow" />

        <div className="flex flex-col items-center gap-2">
          {MODULES.map((m) => {
            const active = module === m.key;
            return (
              <button
                key={m.key}
                onClick={() => onChange(m.key)}
                title={m.label}
                className={`group flex w-14 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[9px] font-semibold transition-all ${
                  active
                    ? "bg-gradient-to-br from-cica-amber/25 to-cica-gold/15 text-cica-gold"
                    : "text-cica-muted hover:bg-cica-border/40 hover:text-cica-silver"
                }`}
              >
                <span className={active ? "drop-shadow-[0_0_6px_rgba(168,85,247,0.7)]" : ""}>{m.icon}</span>
                <span className="leading-tight">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {user && (
        <div className="flex flex-col items-center gap-2">
          <div
            title={`${user.nombre} · ${ROLE_LABEL[user.role] || user.role}`}
            className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-sm font-bold text-cica-black"
          >
            {user.nombre.charAt(0)}
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            className="rounded-lg p-1.5 text-cica-muted transition-colors hover:bg-status-sin/20 hover:text-status-sin"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      )}
    </nav>
  );
}
