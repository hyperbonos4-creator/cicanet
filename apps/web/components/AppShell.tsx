"use client";

import { useState } from "react";
import type { SessionUser, IpLocation } from "../lib/api";

export type Section = "dashboard" | "clientes" | "red" | "infra" | "ordenes" | "soporte" | "tickets" | "contabilidad" | "usuarios";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  operador: "Operador NOC",
  tecnico: "Técnico",
  contador: "Contabilidad",
};

const NAV: { key: Section; label: string; sub: string; roles: string[]; icon: JSX.Element }[] = [
  {
    key: "dashboard", label: "Dashboard", sub: "Resumen operativo", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>),
  },
  {
    key: "clientes", label: "Clientes", sub: "Suscriptores", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></svg>),
  },
  {
    key: "red", label: "Mapa", sub: "Red en vivo · cobertura", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 3 4 6v15l5-3 6 3 5-3V3l-5 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>),
  },
  {
    key: "infra", label: "Editor de Red", sub: "Construir · topología · GIS", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 21V9M7 21V13M17 21V13M5 9l7-5 7 5" /><circle cx="12" cy="6.5" r="1" /></svg>),
  },
  {
    key: "ordenes", label: "Órdenes", sub: "Instalaciones · técnicos", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>),
  },
  {
    key: "soporte", label: "Soporte", sub: "Canal de WhatsApp", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" /></svg>),
  },
  {
    key: "tickets", label: "Tickets", sub: "Solicitudes de soporte", roles: ["admin", "operador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>),
  },
  {
    key: "contabilidad", label: "Contabilidad", sub: "Libros · cartera · reportes", roles: ["admin", "contador"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M4 3h16v18H4zM8 7h8M8 11h8M8 15h5" /><path d="M16 19v2M8 19v2" /></svg>),
  },
  {
    key: "usuarios", label: "Usuarios", sub: "Equipo · accesos", roles: ["admin"],
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 3.5a3 3 0 0 1 0 5.8M21 20c0-2.6-1.6-4.6-4-5.2" /></svg>),
  },
];

export default function AppShell({
  section, onSection, user, onLogout, live, ipLoc, badges, children,
}: {
  section: Section;
  onSection: (s: Section) => void;
  user: SessionUser | null;
  onLogout: () => void;
  live: boolean;
  ipLoc: IpLocation | null;
  badges?: Partial<Record<Section, number>>;
  children: React.ReactNode;
}) {
  const current = NAV.find((n) => n.key === section) ?? NAV[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const role = user?.role ?? "admin";
  const visibleNav = NAV.filter((n) => n.roles.includes(role));

  function go(s: Section) {
    onSection(s);
    setMenuOpen(false);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cica-black text-cica-silver">
      {/* Backdrop (móvil) */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ===== Sidebar ===== */}
      <nav
        className={`fixed inset-y-0 left-0 z-40 flex w-[228px] shrink-0 flex-col border-r border-cica-border/70 bg-cica-navy/95 backdrop-blur-xl transition-transform duration-200 md:static md:z-20 md:translate-x-0 md:bg-cica-navy/80 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center">
            <span className="absolute inset-0 rounded-full bg-cica-glow/30 blur-md" aria-hidden />
            <img src="/vx-emblem.svg" alt="VisionYX" width={40} height={40} className="relative h-10 w-10 rounded-full ring-1 ring-cica-steel/40" />
          </span>
          <div>
            <div className="vx-display text-base font-extrabold leading-none tracking-tight cica-gradient-text">CICANET</div>
            <div className="mt-1 text-[10px] tracking-wide text-cica-muted">ISP · by VisionYX</div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1 px-3 py-2">
          {visibleNav.map((n) => {
            const active = section === n.key;
            const badge = badges?.[n.key] ?? 0;
            return (
              <button
                key={n.key}
                onClick={() => go(n.key)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                  active
                    ? "bg-gradient-to-r from-cica-amber/25 to-cica-gold/10 text-cica-gold"
                    : "text-cica-muted hover:bg-cica-border/30 hover:text-cica-silver"
                }`}
              >
                <span className={`relative ${active ? "drop-shadow-[0_0_6px_rgba(168,85,247,0.6)]" : ""}`}>
                  {n.icon}
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-2 grid h-4 min-w-4 animate-pulseGlow place-items-center rounded-full bg-status-sin px-1 text-[9px] font-bold leading-none text-white shadow-[0_0_8px_rgba(255,77,109,0.7)]">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[13px] font-semibold leading-tight">{n.label}</span>
                  <span className="text-[10px] font-normal text-cica-muted">{n.sub}</span>
                </span>
                {badge > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-status-sin px-1.5 text-[10px] font-bold text-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {user && (
          <div className="flex items-center gap-2.5 border-t border-cica-border/60 px-4 py-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-sm font-bold text-cica-black">
              {user.nombre.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-cica-silver">{user.nombre}</div>
              <div className="text-[10px] text-cica-muted">{ROLE_LABEL[user.role] || user.role}</div>
            </div>
            <button onClick={onLogout} title="Cerrar sesión" className="rounded-lg p-1.5 text-cica-muted transition-colors hover:bg-status-sin/20 hover:text-status-sin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        )}
      </nav>

      {/* ===== Columna principal ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Banner de modo demo (sesión efímera) */}
        {user?.username?.startsWith("demo_") && (
          <div className="flex shrink-0 items-center justify-center gap-2 bg-gradient-to-r from-cica-amber/20 via-cica-glow/20 to-cica-gold/20 px-4 py-1.5 text-center text-[11px] font-semibold text-cica-silver">
            <span className="inline-block h-2 w-2 animate-pulseGlow rounded-full bg-cica-amber" />
            Estás en una <b className="mx-1 text-cica-gold">sesión de demostración</b> de VISIONYX Telecom · datos de ejemplo · se elimina sola al expirar
          </div>
        )}
        {/* Topbar */}
        <header className="z-10 flex shrink-0 items-center justify-between border-b border-cica-border/70 bg-cica-navy/60 px-6 py-3.5 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMenuOpen(true)}
              className="rounded-lg p-1.5 text-cica-silver hover:bg-cica-border/40 md:hidden"
              title="Menú"
              aria-label="Abrir menú"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
            </button>
            <div>
              <h1 className="text-[15px] font-extrabold tracking-tight text-white">{current.label}</h1>
              <p className="text-[11px] text-cica-muted">{current.sub}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {ipLoc && (
              <div className="hidden items-center gap-2 rounded-lg border border-cica-border/70 bg-cica-panel/50 px-3 py-1.5 sm:flex" title={ipLoc.ip ? `IP ${ipLoc.ip}` : undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-cica-steelLight"><path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>
                <span className="text-xs font-semibold text-cica-silver">{ipLoc.ciudad || "Ubicación"}<span className="ml-1 text-[10px] font-normal text-cica-muted">{ipLoc.fuente === "ip-api" ? "· por IP" : "· local"}</span></span>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-cica-border/70 bg-cica-panel/50 px-3 py-1.5">
              <span className="relative flex h-2.5 w-2.5">
                {live && <span className="absolute inline-flex h-full w-full animate-pulseGlow rounded-full bg-status-ftth opacity-75" />}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-status-ftth" : "bg-cica-muted"}`} />
              </span>
              <span className="text-xs font-semibold text-cica-silver">{live ? "En vivo" : "Conectando…"}</span>
            </div>
          </div>
        </header>

        {/* Contenido */}
        <main className="relative min-h-0 flex-1">
          {/* Fondo de marca (no para secciones de mapa, que lo cubren) */}
          <div className="pointer-events-none absolute inset-0 bg-cica-radial" />
          <div className="relative h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
