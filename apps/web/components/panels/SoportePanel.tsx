"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getSupportWhatsapp,
  setSupportWhatsapp,
  whatsappStatus,
  whatsappConnect,
  whatsappPair,
  whatsappLogout,
  whatsappChats,
  whatsappHandoffs,
  atenderHandoff,
  cerrarHandoff,
  type SupportWhatsapp,
  type WaStatus,
  type WaChat,
  type SolicitudAsesor,
} from "../../lib/api";

/**
 * Soporte por WhatsApp. La empresa vincula su teléfono escaneando un QR
 * (Evolution API self-hosted); ese número queda como receptor de los chats con
 * los clientes, que se listan debajo. El número manual queda como respaldo.
 */
export default function SoportePanel({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [chats, setChats] = useState<WaChat[]>([]);
  const [handoffs, setHandoffs] = useState<SolicitudAsesor[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await whatsappStatus();
      setStatus(s);
      if (s.state === "open") {
        try {
          setChats(await whatsappChats());
        } catch {
          /* noop */
        }
      }
      // Las solicitudes de asesor llegan aunque WhatsApp no esté vinculado.
      try {
        setHandoffs(await whatsappHandoffs());
      } catch {
        /* noop */
      }
      return s;
    } catch (e: any) {
      setErr(e.message);
      return null;
    }
  }, []);

  async function onAtender(s: SolicitudAsesor) {
    try {
      const r = await atenderHandoff(s.id);
      if (r.url) {
        // Abre WhatsApp (app) o WhatsApp Web con un saludo NUEVO al cliente.
        window.open(r.url, "_blank", "noopener,noreferrer");
      } else {
        alert("La solicitud no tiene un número de teléfono del cliente. Contáctalo por otro medio.");
      }
      await refreshStatus();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function onCerrar(s: SolicitudAsesor) {
    try {
      await cerrarHandoff(s.id);
      await refreshStatus();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function loop() {
      const s = await refreshStatus();
      if (cancelled) return;
      // Mientras se muestra el QR conviene refrescar rápido (expira en segundos);
      // ya conectado, lento. Esto evita escanear un QR vencido por la latencia del túnel.
      const delay =
        s?.state === "qr" ? 1800 : s?.state === "connecting" ? 2500 : s?.state === "open" ? 8000 : 4000;
      timer = setTimeout(loop, delay);
    }
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshStatus]);

  async function onConnect() {
    setConnecting(true);
    setErr(null);
    try {
      setStatus(await whatsappConnect());
    } catch (e: any) {
      setErr(e.message || "No se pudo iniciar la vinculación.");
    } finally {
      setConnecting(false);
    }
  }

  async function onLogout() {
    if (!confirm("¿Desvincular el WhatsApp de la empresa? Tendrás que escanear el QR otra vez.")) return;
    try {
      await whatsappLogout();
      setChats([]);
      await refreshStatus();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const connected = status?.state === "open";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <WaIcon />
        <h2 className="text-xl font-extrabold text-white">Soporte por WhatsApp</h2>
      </div>
      <p className="mb-5 text-xs text-cica-muted">
        Vincula el teléfono de CICANET escaneando el código QR. Ese número queda
        como receptor de los chats de soporte; los clientes lo abren desde la app
        al tocar <span className="text-cica-silver">Soporte</span>.
      </p>

      {/* ===== Vinculación ===== */}
      <div className="glass p-5">
        {connected ? (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-pulseGlow rounded-full bg-status-ftth opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-status-ftth" />
              </span>
              <div>
                <div className="text-sm font-bold text-white">WhatsApp vinculado</div>
                <div className="text-[11px] text-cica-muted">
                  Número receptor:{" "}
                  <span className="font-semibold text-cica-silver">
                    {status?.numero ? formatNum(status.numero) : "conectado"}
                  </span>
                </div>
              </div>
            </div>
            {canEdit && (
              <button
                onClick={onLogout}
                className="rounded-lg border border-status-sin/40 px-3 py-1.5 text-xs font-semibold text-status-sin transition-colors hover:bg-status-sin/10"
              >
                Desvincular
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {status?.qrDataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={status.qrDataUrl}
                  alt="QR de vinculación de WhatsApp"
                  className="h-60 w-60 rounded-xl border border-cica-border bg-white p-2"
                />
                <p className="max-w-sm text-center text-xs text-cica-muted">
                  En el teléfono de CICANET abre <b className="text-cica-silver">WhatsApp → Dispositivos
                  vinculados → Vincular un dispositivo</b> y escanea este código. Se
                  actualiza solo.
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="grid h-60 w-60 place-items-center rounded-xl border border-dashed border-cica-border/70 bg-cica-navy/40">
                  {connecting || status?.state === "connecting" ? (
                    <div className="flex flex-col items-center gap-3 text-cica-muted">
                      <div className="h-9 w-9 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
                      <span className="text-xs">Generando código QR…</span>
                    </div>
                  ) : (
                    <span className="px-6 text-xs text-cica-muted">
                      Aún no hay un teléfono vinculado.
                    </span>
                  )}
                </div>
              </div>
            )}
            {canEdit && (
              <button
                onClick={onConnect}
                disabled={connecting}
                className="btn-cica disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connecting ? "Generando…" : status?.qrDataUrl ? "Regenerar QR" : "Vincular WhatsApp"}
              </button>
            )}
            {canEdit && <PairByCode />}
            {!canEdit && (
              <p className="text-[11px] text-cica-muted">Solo un administrador puede vincular el WhatsApp.</p>
            )}
          </div>
        )}
        {err && (
          <div className="mt-4 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">
            {err}
          </div>
        )}
      </div>

      {/* ===== Solicitudes de asesor (handoff del bot) ===== */}
      {(() => {
        const pendientes = handoffs.filter((h) => h.estado === "pendiente");
        if (pendientes.length === 0) return null;
        return (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Solicitudes de asesor</h3>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-status-sin px-1.5 text-[10px] font-bold text-white">{pendientes.length}</span>
            </div>
            <div className="glass divide-y divide-cica-border/50 overflow-hidden p-0">
              {pendientes.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-status-sin/20 text-sm font-bold text-status-sin">!</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-cica-silver">{h.nombre || (h.telefono ? formatNum(h.telefono) : "Cliente")}</span>
                      <span className="shrink-0 text-[10px] text-cica-muted">{new Date(h.creadoEn).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="truncate text-xs text-cica-muted">{h.motivo || "Pidió hablar con un asesor"}{h.telefono ? "" : " · sin teléfono"}</div>
                  </div>
                  <button
                    onClick={() => onAtender(h)}
                    disabled={!h.telefono}
                    className="shrink-0 rounded-lg bg-status-ftth/20 px-3 py-1.5 text-xs font-bold text-status-ftth transition-colors hover:bg-status-ftth/30 disabled:opacity-40"
                  >
                    Atender por WhatsApp
                  </button>
                  <button onClick={() => onCerrar(h)} className="shrink-0 text-[11px] text-cica-muted hover:text-status-sin">Descartar</button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-cica-muted">
              "Atender" abre WhatsApp (o WhatsApp Web) con un saludo nuevo al cliente. No se traslada lo que habló con el bot.
            </p>
          </div>
        );
      })()}

      {/* ===== Bandeja de chats ===== */}
      {connected && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Chats de clientes</h3>
            <span className="text-[11px] text-cica-muted">{chats.length} conversación(es)</span>
          </div>
          <div className="glass divide-y divide-cica-border/50 overflow-hidden p-0">
            {chats.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-cica-muted">
                Aún no hay mensajes. Cuando un cliente escriba, aparecerá aquí. El
                chat completo está en el teléfono vinculado.
              </div>
            ) : (
              chats.map((c) => <ChatRow key={c.jid} c={c} />)
            )}
          </div>
          <p className="mt-2 text-[10px] text-cica-muted">
            Esta es una vista espejo de las conversaciones recientes. Responde
            desde WhatsApp en el teléfono de la empresa.
          </p>
        </div>
      )}

      {/* ===== Número manual (respaldo) ===== */}
      <ManualFallback canEdit={canEdit} />
    </div>
  );
}

function ChatRow({ c }: { c: WaChat }) {
  const hora = new Date(c.ts).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const waUrl = `https://wa.me/${c.numero}`;
  return (
    <a
      href={waUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cica-border/20"
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-sm font-bold text-cica-black">
        {(c.nombre || c.numero).charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-cica-silver">
            {c.nombre || formatNum(c.numero)}
          </span>
          <span className="shrink-0 text-[10px] text-cica-muted">{hora}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {c.entrante ? null : <span className="text-[10px] text-cica-muted">Tú:</span>}
          <span className="truncate text-xs text-cica-muted">{c.ultimoMensaje}</span>
        </div>
      </div>
      {c.noLeidos > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-status-ftth px-1.5 text-[10px] font-bold text-cica-black">
          {c.noLeidos}
        </span>
      )}
    </a>
  );
}

function PairByCode() {
  const [open, setOpen] = useState(false);
  const [numero, setNumero] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function obtener() {
    setBusy(true);
    setMsg(null);
    setCode(null);
    try {
      const r = await whatsappPair(numero);
      if (r.pairingCode) setCode(r.pairingCode);
      else setMsg("No se pudo generar el código. Verifica el número (con indicativo) e intenta de nuevo.");
    } catch (e: any) {
      setMsg(e.message || "No se pudo generar el código.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <button onClick={() => setOpen((o) => !o)} className="mx-auto block text-[11px] text-cica-steelLight hover:underline">
        ¿No puedes escanear el QR? Vincular por código
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-cica-border/40 p-4">
          <p className="text-[11px] text-cica-muted">
            Escribe el número del teléfono de CICANET (con indicativo, ej. +57 300 123 4567) y pulsa
            "Obtener código". Luego en ese teléfono: <b className="text-cica-silver">WhatsApp → Dispositivos
            vinculados → Vincular un dispositivo → Vincular con número de teléfono</b> e ingresa el código.
          </p>
          <input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="+57 300 123 4567"
            className="rounded-xl border border-cica-border bg-cica-navy/80 px-4 py-2.5 text-sm text-cica-silver outline-none focus:border-cica-gold"
          />
          <button onClick={obtener} disabled={busy || numero.replace(/\D/g, "").length < 10} className="btn-cica disabled:opacity-50">
            {busy ? "Generando…" : "Obtener código"}
          </button>
          {code && (
            <div className="rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-2 text-center">
              <div className="text-[10px] uppercase tracking-wide text-cica-muted">Código de vinculación</div>
              <div className="text-2xl font-extrabold tracking-[0.3em] text-status-ftth">{code}</div>
            </div>
          )}
          {msg && <span className="text-[11px] text-cica-muted">{msg}</span>}
        </div>
      )}
    </div>
  );
}

function ManualFallback({ canEdit }: { canEdit: boolean }) {
  const [cfg, setCfg] = useState<SupportWhatsapp | null>(null);
  const [numero, setNumero] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getSupportWhatsapp()
      .then((c) => {
        setCfg(c);
        setNumero(c.numeroFormateado || "");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const c = await setSupportWhatsapp({ numero, habilitado: true });
      setCfg(c);
      setNumero(c.numeroFormateado);
      setMsg("Número de respaldo guardado.");
    } catch (e: any) {
      setMsg(e.message || "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-cica-border/60 bg-cica-navy/40 px-4 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-cica-silver">
          Número de respaldo (si no hay WhatsApp vinculado)
        </span>
        <span className="text-cica-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-cica-border/40 p-4">
          <p className="text-[11px] text-cica-muted">
            Si el teléfono no está vinculado por QR, la app usa este número para
            abrir el chat. Incluye el indicativo de país.
          </p>
          <input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={!canEdit}
            placeholder="+57 300 123 4567"
            className="rounded-xl border border-cica-border bg-cica-navy/80 px-4 py-2.5 text-sm text-cica-silver outline-none focus:border-cica-gold disabled:opacity-60"
          />
          {cfg?.url && (
            <a href={cfg.url} target="_blank" rel="noreferrer" className="break-all text-[11px] text-status-ftth hover:underline">
              {cfg.url}
            </a>
          )}
          {msg && <span className="text-[11px] text-cica-muted">{msg}</span>}
          {canEdit && (
            <button onClick={save} disabled={saving} className="btn-cica w-full disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar número de respaldo"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatNum(d: string): string {
  if (d.startsWith("57") && d.length === 12) {
    const n = d.slice(2);
    return `+57 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+${d}`;
}

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-status-ftth">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.46 15.05L2 22l5.07-1.33A9.9 9.9 0 1 0 12.04 2Zm5.8 14.06c-.24.69-1.2 1.27-1.96 1.43-.52.11-1.2.2-3.5-.75-2.94-1.22-4.83-4.2-4.98-4.4-.14-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.78-.37.2 0 .39 0 .56.01.18.01.42-.07.66.5.24.59.82 2.04.9 2.19.07.15.12.32.02.52-.1.2-.15.32-.3.5-.14.17-.3.39-.43.52-.14.14-.29.3-.12.58.17.3.74 1.22 1.59 1.98 1.09.97 2.01 1.27 2.3 1.42.29.15.46.12.63-.07.17-.2.72-.84.91-1.13.2-.3.39-.24.66-.15.27.1 1.71.81 2 .96.29.15.49.22.56.34.07.12.07.69-.17 1.38Z" />
    </svg>
  );
}
