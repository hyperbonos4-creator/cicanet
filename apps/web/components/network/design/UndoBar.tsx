"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { undoStack } from "../../../lib/undoStack";

const hace = (ts: number) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/**
 * Barra de DESHACER del diseño de red. Permite revertir tarea por tarea lo que
 * el operador va construyendo (colocar activos, trazar/encadenar fibra…) o
 * saltar varias de golpe desde la lista. Atajo: Ctrl/⌘+Z.
 */
export default function UndoBar() {
  // Suscripción al store singleton (se re-renderiza cuando cambia el historial).
  const version = useSyncExternalStore(
    (cb) => undoStack.subscribe(cb),
    () => undoStack.size() + (undoStack.isBusy() ? 100000 : 0),
    () => 0,
  );
  void version;

  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const size = undoStack.size();
  const busy = undoStack.isBusy();
  const items = undoStack.list();
  const last = items[0];

  const doUndo = async () => {
    setErr(null);
    try { await undoStack.undo(); } catch (e: any) { setErr(e?.message || "No se pudo deshacer"); }
  };
  const doUndoTo = async (id: string) => {
    setErr(null);
    try { await undoStack.undoTo(id); setOpen(false); } catch (e: any) { setErr(e?.message || "No se pudo deshacer"); }
  };

  // Atajo de teclado Ctrl/⌘+Z (ignora si se está escribiendo en un campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const t = e.target as HTMLElement;
        const tag = t?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
        e.preventDefault();
        doUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="rounded-xl border border-cica-border/70 bg-cica-navy/40 p-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={doUndo}
          disabled={size === 0 || busy}
          className="flex items-center gap-1.5 rounded-lg border border-cica-gold/40 bg-cica-gold/10 px-3 py-1.5 text-[11px] font-bold text-cica-gold transition-colors hover:bg-cica-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
          title="Deshacer la última tarea (Ctrl+Z)"
        >
          {busy ? "Deshaciendo…" : "↶ Deshacer"}
        </button>
        <span className="rounded-full bg-cica-border/50 px-2 py-0.5 text-[10px] font-semibold text-cica-silver">{size}</span>
        {last && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-cica-muted" title={last.label}>
            {last.label}
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={size === 0}
          className="ml-auto shrink-0 text-[10px] text-cica-muted hover:text-cica-silver disabled:opacity-40"
        >
          {open ? "▾" : "Historial ▸"}
        </button>
      </div>

      {err && <div className="mt-1.5 text-[10px] text-status-sin">{err}</div>}

      {open && size > 0 && (
        <div className="mt-2 flex max-h-44 flex-col gap-0.5 overflow-y-auto border-t border-cica-border/50 pt-2">
          <div className="px-1 pb-1 text-[9px] uppercase tracking-wide text-cica-muted">
            Toca una tarea para volver hasta ahí
          </div>
          {items.map((e, i) => (
            <button
              key={e.id}
              onClick={() => doUndoTo(e.id)}
              disabled={busy}
              className="group flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-cica-border/40 disabled:opacity-50"
              title={`Deshacer hasta aquí (${i + 1} tarea${i ? "s" : ""})`}
            >
              <span className="text-[9px] font-bold text-cica-muted">{i + 1}</span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cica-gold" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-cica-silver">{e.label}</span>
              <span className="shrink-0 text-[9px] text-cica-muted">{hace(e.at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
