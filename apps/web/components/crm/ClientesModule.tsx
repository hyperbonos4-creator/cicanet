"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listClientes,
  createCliente,
  updateCliente,
  deleteCliente,
  getCliente,
  type Cliente,
  type ClienteInput,
  type ClienteStats,
} from "../../lib/api";
import ClienteForm from "./ClienteForm";
import ClienteDetail from "./ClienteDetail";
import Customer360 from "./Customer360";

const ESTADO_TONE: Record<string, string> = {
  activo: "text-status-ftth bg-status-ftth/10 border-status-ftth/30",
  suspendido: "text-status-parcial bg-status-parcial/10 border-status-parcial/30",
  moroso: "text-status-parcial bg-status-parcial/10 border-status-parcial/30",
  retirado: "text-cica-muted bg-cica-border/30 border-cica-border/60",
};
const SERVICIO_LABEL: Record<string, string> = {
  instalacion_pendiente: "Instalación pendiente",
  activo: "Activo",
  suspendido: "Suspendido",
  cortado: "Cortado",
};

type View = { mode: "list" } | { mode: "new" } | { mode: "edit"; cliente: Cliente } | { mode: "detail"; id: string } | { mode: "c360"; id: string };

export default function ClientesModule({
  canEdit,
  napOptions,
  stats,
  onChanged,
  onVerEnMapa,
}: {
  canEdit: boolean;
  napOptions: { id: string; nombre: string }[];
  stats: ClienteStats | null;
  onChanged: () => void;
  onVerEnMapa?: (lng: number, lat: number) => void;
}) {
  const [view, setView] = useState<View>({ mode: "list" });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTec, setFTec] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      setClientes(await listClientes({ q, estado: fEstado, tecnologia: fTec }));
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [q, fEstado, fTec]);

  useEffect(() => {
    const h = setTimeout(refresh, 250);
    return () => clearTimeout(h);
  }, [refresh]);

  async function handleSave(input: ClienteInput, id?: string) {
    if (id) await updateCliente(id, input);
    else await createCliente(input);
    setView({ mode: "list" });
    await refresh();
    onChanged();
  }

  async function handleDelete(id: string) {
    await deleteCliente(id);
    setView({ mode: "list" });
    await refresh();
    onChanged();
  }

  async function quickEstado(c: Cliente, estado: Cliente["estado"], estadoServicio: Cliente["estadoServicio"]) {
    await updateCliente(c.id, { estado, estadoServicio });
    await refresh();
    onChanged();
  }

  if (view.mode === "new" || view.mode === "edit") {
    return (
      <ClienteForm
        initial={view.mode === "edit" ? view.cliente : null}
        napOptions={napOptions}
        onCancel={() => setView(view.mode === "edit" ? { mode: "detail", id: view.cliente.id } : { mode: "list" })}
        onSave={handleSave}
      />
    );
  }

  if (view.mode === "detail") {
    return (
      <ClienteDetail
        id={view.id}
        canEdit={canEdit}
        napOptions={napOptions}
        onBack={() => setView({ mode: "list" })}
        onEdit={(c) => setView({ mode: "edit", cliente: c })}
        onDelete={handleDelete}
        onQuickEstado={quickEstado}
      />
    );
  }

  if (view.mode === "c360") {
    return (
      <Customer360
        id={view.id}
        canEdit={canEdit}
        onBack={() => setView({ mode: "list" })}
        onVerEnMapa={onVerEnMapa}
        onEdit={async (cid) => {
          try {
            const full = await getCliente(cid);
            setView({ mode: "edit", cliente: full });
          } catch {
            setView({ mode: "detail", id: cid });
          }
        }}
      />
    );
  }

  // ---- Vista lista ----
  return (
    <div className="mx-auto max-w-6xl">
      {/* KPIs */}
      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Suscriptores" value={fmt(stats.total)} tone="gold" />
          <StatCard label="Activos" value={fmt(stats.porServicio.activo || 0)} tone="ftth" />
          <StatCard label="Ingreso mensual" value={money(stats.ingresoMensual)} tone="silver" />
          <StatCard label="Cartera pendiente" value={money(stats.saldoPendiente)} tone={stats.saldoPendiente > 0 ? "sin" : "silver"} />
        </div>
      )}

      <div className="glass p-0">
        {/* Barra superior */}
        <div className="flex flex-wrap items-center gap-2 border-b border-cica-border/60 p-4">
          <h2 className="mr-auto text-sm font-bold text-white">Suscriptores</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, documento, plan…" className={inputCls + " w-56"} />
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={selCls}>
            <option value="">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
            <option value="moroso">Moroso</option>
            <option value="retirado">Retirado</option>
          </select>
          <select value={fTec} onChange={(e) => setFTec(e.target.value)} className={selCls}>
            <option value="">Toda tecnología</option>
            <option value="FTTH">FTTH</option>
            <option value="Inalambrico">Inalámbrico</option>
            <option value="HFC">HFC</option>
          </select>
          {canEdit && (
            <button onClick={() => setView({ mode: "new" })} className="btn-cica text-xs">+ Nuevo cliente</button>
          )}
        </div>

        {err && <div className="m-4 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-cica-border/60 text-[10px] uppercase tracking-wider text-cica-muted">
                <th className="px-4 py-2.5 font-semibold">Cliente</th>
                <th className="px-4 py-2.5 font-semibold">Documento</th>
                <th className="px-4 py-2.5 font-semibold">Plan</th>
                <th className="px-4 py-2.5 font-semibold">Tecnología</th>
                <th className="px-4 py-2.5 font-semibold">Servicio</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
                <th className="px-4 py-2.5 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-cica-muted">Cargando suscriptores…</td></tr>
              ) : clientes.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-cica-muted">
                  Sin suscriptores. {canEdit && "Crea el primero con + Nuevo cliente."}
                </td></tr>
              ) : (
                clientes.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setView({ mode: "c360", id: c.id })}
                    className="cursor-pointer border-b border-cica-border/30 transition-colors hover:bg-cica-navy/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-cica-silver">{c.nombre}</div>
                      <div className="text-[10px] text-cica-muted">{c.id} · {c.barrio || c.ciudad}</div>
                    </td>
                    <td className="px-4 py-2.5 text-cica-muted">{c.tipoDocumento} {c.documento}</td>
                    <td className="px-4 py-2.5 text-cica-silver">{c.plan}{c.velocidadBajada ? ` · ${c.velocidadBajada}M` : ""}</td>
                    <td className="px-4 py-2.5 text-cica-muted">{c.tecnologia}</td>
                    <td className="px-4 py-2.5 text-cica-muted">{SERVICIO_LABEL[c.estadoServicio] || c.estadoServicio}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${ESTADO_TONE[c.estado] || ESTADO_TONE.retirado}`}>{c.estado}</span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${c.saldo && c.saldo > 0 ? "text-status-sin" : "text-cica-muted"}`}>{money(c.saldo || 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && clientes.length > 0 && (
          <div className="border-t border-cica-border/60 px-4 py-2 text-[10px] text-cica-muted">{clientes.length} suscriptor(es)</div>
        )}
      </div>
    </div>
  );
}

/* ---- helpers compartidos ---- */
export const inputCls = "rounded-lg border border-cica-border bg-cica-navy/80 px-3 py-2 text-xs text-cica-silver outline-none focus:border-cica-gold";
export const selCls = inputCls;

export function fmt(n: number) {
  return new Intl.NumberFormat("es-CO").format(n);
}
export function money(n: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

const TONE: Record<string, string> = {
  gold: "text-cica-gold", ftth: "text-status-ftth", silver: "text-cica-silver", sin: "text-status-sin",
};
function StatCard({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONE }) {
  return (
    <div className="glass p-4">
      <div className={`text-xl font-extrabold ${TONE[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-cica-muted">{label}</div>
    </div>
  );
}
