"use client";

import { useEffect, useRef, useState } from "react";
import {
  assistantInfo,
  assistantChat,
  getSupportWhatsapp,
  type CicaAccion,
  type CicaPago,
} from "../lib/api";

type Msg = {
  role: "user" | "assistant";
  content: string;
  acciones?: CicaAccion[];
  pago?: CicaPago;
  ai?: boolean;
};

/**
 * Widget flotante del asistente virtual "Cica". Agente de soporte con IA que
 * responde con datos reales de CICANET (cobertura, pagos, contacto) y puede
 * escalar a un asesor humano por WhatsApp.
 */
export default function CicaAssistant() {
  const [open, setOpen] = useState(false);
  const [ia, setIa] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && !ready) {
      assistantInfo()
        .then((info) => {
          setIa(info.ia);
          setMsgs([{ role: "assistant", content: info.saludo, acciones: info.acciones, ai: info.ia }]);
        })
        .catch(() => setMsgs([{ role: "assistant", content: "¡Hola! Soy Cica, el asistente de CICANET. ¿En qué te ayudo?" }]))
        .finally(() => setReady(true));
    }
  }, [open, ready]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, sending]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next);
    setSending(true);
    try {
      const history = next.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
      const r = await assistantChat(history);
      setMsgs((m) => [...m, { role: "assistant", content: r.reply, acciones: r.acciones, pago: r.pago, ai: r.ai }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Tuve un problema para responder. Intenta de nuevo." }]);
    } finally {
      setSending(false);
    }
  }

  async function onAccion(a: CicaAccion) {
    if (a.tipo === "whatsapp") {
      try {
        const w = await getSupportWhatsapp();
        if (w.url) { window.open(w.url, "_blank"); return; }
      } catch { /* noop */ }
      send("Quiero hablar con un asesor");
      return;
    }
    const map: Record<string, string> = {
      pagar: "Quiero pagar mi factura",
      cobertura: "¿Tienen cobertura en mi dirección?",
      planes: "¿Qué planes y velocidades manejan?",
      facturas: "Quiero ver mis facturas",
    };
    send(map[a.tipo] || a.label);
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-cica-black shadow-glow transition-transform hover:scale-105"
        title="Asistente CICANET"
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-6 w-6"><path d="M18 6 6 18M6 6l12 12" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path d="M12 2a2 2 0 0 1 2 2v1h1a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5H9l-4 3v-3a5 5 0 0 1-5-5v-4a5 5 0 0 1 5-5h1V4a2 2 0 0 1 2-2Zm-3 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" /></svg>
        )}
      </button>

      {open && (
        <div className="glass fixed bottom-24 right-6 z-50 flex h-[560px] max-h-[80vh] w-[380px] max-w-[92vw] flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-cica-border/60 bg-cica-navy/60 px-4 py-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-cica-black">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M12 2 4 7v10l8 5 8-5V7l-8-5Zm0 4 4 2.5v5L12 16l-4-2.5v-5L12 6Z" /></svg>
            </div>
            <div>
              <div className="text-sm font-bold text-white">Cica</div>
              <div className="flex items-center gap-1.5 text-[10px] text-cica-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-status-ftth" />
                {ia ? "Asistente IA · en línea" : "Asistente · en línea"}
              </div>
            </div>
          </div>

          {/* Mensajes */}
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug ${m.role === "user" ? "bg-cica-gold text-cica-black" : "bg-cica-panel/70 text-cica-silver"}`}>
                  {m.content}
                </div>
                {m.pago?.url && (
                  <a href={m.pago.url} target="_blank" rel="noreferrer" className="btn-cica mt-2 text-xs">
                    Pagar ${m.pago.monto.toLocaleString("es-CO")} ahora
                  </a>
                )}
                {m.role === "assistant" && m.acciones && m.acciones.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.acciones.map((a) => (
                      <button key={a.id} onClick={() => onAccion(a)} className="rounded-full border border-cica-gold/50 bg-cica-gold/10 px-2.5 py-1 text-[11px] font-semibold text-cica-gold transition-colors hover:bg-cica-gold/20">
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 rounded-2xl bg-cica-panel/70 px-3.5 py-2.5 text-[12px] text-cica-muted w-fit">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" />
                Cica está escribiendo…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="border-t border-cica-border/60 p-3">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder="Escribe tu mensaje…"
                disabled={sending}
                className="flex-1 rounded-xl border border-cica-border bg-cica-navy/80 px-3.5 py-2.5 text-[13px] text-cica-silver outline-none focus:border-cica-gold disabled:opacity-60"
              />
              <button
                onClick={() => send(input)}
                disabled={sending || !input.trim()}
                className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cica-amber to-cica-gold text-cica-black disabled:opacity-50"
                title="Enviar"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="m3 3 18 9-18 9 4-9-4-9Zm4.5 9H13" stroke="currentColor" strokeWidth="0" /><path d="M2 21 23 12 2 3v7l15 2-15 2v7Z" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
