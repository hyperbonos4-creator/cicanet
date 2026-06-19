"use client";

import { useState } from "react";
import Image from "next/image";
import { login } from "../../lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Leemos del DOM (no solo del estado) para que el autocompletado del
    // navegador funcione aunque no dispare onChange en React.
    const form = e.currentTarget;
    const data = new FormData(form);
    const u = String(data.get("username") ?? username).trim();
    const p = String(data.get("password") ?? password);

    if (!u || !p) {
      setError("Ingresa tu usuario y contraseña.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await login(u, p);
      // Navegación dura: garantiza que el middleware reevalúe con la cookie
      // recién creada (evita rebotes a /login vía proxy/ngrok).
      window.location.assign("/");
    } catch (err: any) {
      setError(err.message || "No se pudo iniciar sesión");
      setLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-cica-black px-4">
      {/* Fondo de marca */}
      <div className="pointer-events-none absolute inset-0 bg-cica-radial" />
      <div className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-cica-gold/15 blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 bottom-1/4 h-96 w-96 rounded-full bg-cica-steel/20 blur-[120px]" />

      <div className="glass relative z-10 w-full max-w-sm animate-fadeUp p-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image
            src="/cicanet-logo.png"
            alt="CICANET"
            width={84}
            height={84}
            className="mb-3 rounded-full shadow-glow"
            priority
          />
          <h1 className="text-2xl font-extrabold tracking-tight cica-gradient-text">
            CICANET
          </h1>
          <p className="mt-1 text-xs text-cica-muted">
            La red del futuro · acceso restringido
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-cica-muted">Usuario</span>
            <input
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="rounded-xl border border-cica-border bg-cica-navy/80 px-4 py-2.5 text-sm text-cica-silver outline-none transition-colors focus:border-cica-gold"
              placeholder="admin"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-cica-muted">Contraseña</span>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-xl border border-cica-border bg-cica-navy/80 px-4 py-2.5 text-sm text-cica-silver outline-none transition-colors focus:border-cica-gold"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-cica mt-1 w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-cica-muted">
          Demo · usuario <span className="text-cica-silver">admin</span> ·
          contraseña <span className="text-cica-silver">cicanet2026</span>
        </p>
      </div>
    </main>
  );
}
