"use client";

import { useEffect, useMemo, useState } from "react";
import {
  accountingDashboard,
  listAsientos,
  crearAsiento,
  reversarAsiento,
  listCuentas,
  listTercerosContables,
  crearTerceroContable,
  balanceComprobacion,
  estadoResultados,
  balanceGeneral,
  listPeriodos,
  cerrarPeriodo,
  getAging,
  getAgingPorZona,
  type AsientoContable,
  type CuentaContable,
  type TerceroContable,
  type LineaAsiento,
  type PeriodoContable,
  type Aging,
  type AgingZona,
} from "../../lib/api";

type Tab = "dashboard" | "cartera" | "asientos" | "nuevo" | "cuentas" | "reportes" | "periodos";

const money = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Resumen" },
  { key: "cartera", label: "Cartera" },
  { key: "asientos", label: "Comprobantes" },
  { key: "nuevo", label: "Nuevo asiento" },
  { key: "cuentas", label: "Plan de cuentas" },
  { key: "reportes", label: "Reportes" },
  { key: "periodos", label: "Periodos" },
];

export default function ContabilidadModule({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div className="mx-auto max-w-6xl">
      <h2 className="mb-1 text-xl font-extrabold text-white">Contabilidad</h2>
      <p className="mb-4 text-xs text-cica-muted">Libros, cartera y reportes financieros de CICANET (PUC Colombia, doble partida).</p>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-cica-border/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.key ? "bg-cica-gold/20 text-cica-gold" : "text-cica-muted hover:text-cica-silver"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "cartera" && <CarteraTab />}
      {tab === "asientos" && <AsientosTab canEdit={canEdit} />}
      {tab === "nuevo" && <NuevoAsientoTab canEdit={canEdit} onDone={() => setTab("asientos")} />}
      {tab === "cuentas" && <CuentasTab />}
      {tab === "reportes" && <ReportesTab />}
      {tab === "periodos" && <PeriodosTab canEdit={canEdit} />}
    </div>
  );
}

/* ===================== Dashboard ===================== */
function DashboardTab() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    accountingDashboard().then(setD).catch((e) => setErr(e.message));
  }, []);
  if (err) return <Aviso texto={err} />;
  if (!d) return <Cargando />;
  return (
    <div>
      <div className="mb-2 text-[11px] text-cica-muted">Periodo {d.periodo}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Ingresos del periodo" value={money(d.ingresos)} accent="text-status-ftth" />
        <Kpi label="Gastos + costos" value={money(d.gastos)} accent="text-status-parcial" />
        <Kpi label="Utilidad neta" value={money(d.utilidadNeta)} accent={d.utilidadNeta >= 0 ? "text-cica-gold" : "text-status-sin"} />
        <Kpi label="Cartera (CxC clientes)" value={money(d.cartera)} accent="text-cica-steelLight" />
        <Kpi label="Bancos y caja" value={money(d.bancosCaja)} accent="text-cica-silver" />
        <Kpi label="Comprobantes del periodo" value={String(d.asientosDelPeriodo)} accent="text-cica-muted" />
      </div>
    </div>
  );
}

/* ===================== Cartera / Aging ===================== */
function CarteraTab() {
  const [aging, setAging] = useState<Aging | null>(null);
  const [zona, setZona] = useState<AgingZona | null>(null);
  const [dim, setDim] = useState<"barrio" | "comuna" | "nap">("barrio");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getAging({ soloVencidos }).then(setAging).catch((e) => setErr(e.message)); }, [soloVencidos]);
  useEffect(() => { getAgingPorZona(dim).then(setZona).catch(() => {}); }, [dim]);

  if (err) return <Aviso texto={err} />;
  if (!aging) return <Cargando />;

  const b = aging.resumen;
  return (
    <div className="flex flex-col gap-5">
      {/* KPIs de cartera */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cartera total" value={money(aging.totalCartera)} accent="text-cica-gold" />
        <Kpi label="Cartera vencida" value={money(aging.totalVencido)} accent={aging.totalVencido > 0 ? "text-status-sin" : "text-cica-silver"} />
        <Kpi label="Clientes con deuda" value={String(aging.clientesConDeuda)} accent="text-cica-steelLight" />
        <Kpi label="+90 días (crítico)" value={money(b.d90mas)} accent={b.d90mas > 0 ? "text-status-sin" : "text-cica-muted"} />
      </div>

      {/* Distribución por antigüedad */}
      <div className="glass p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Antigüedad de cartera</div>
        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          <BucketCell label="Por vencer" value={b.porVencer} color="#22E0A1" />
          <BucketCell label="1-30 días" value={b.d1_30} color="#FFB02E" />
          <BucketCell label="31-60 días" value={b.d31_60} color="#FF9838" />
          <BucketCell label="61-90 días" value={b.d61_90} color="#FF6B4D" />
          <BucketCell label="+90 días" value={b.d90mas} color="#FF4D6D" />
        </div>
      </div>

      {/* Por zona/NAP */}
      <div className="glass p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-cica-muted">Cartera por {dim}</div>
          <div className="flex gap-1">
            {(["barrio", "comuna", "nap"] as const).map((d) => (
              <button key={d} onClick={() => setDim(d)} className={`rounded px-2 py-0.5 text-[11px] ${dim === d ? "bg-cica-gold/20 text-cica-gold" : "text-cica-muted hover:text-cica-silver"}`}>{d}</button>
            ))}
          </div>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">{dim}</th><th className="text-right">Clientes</th><th className="text-right">Vencido</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {zona?.grupos.map((g) => (
              <tr key={g.nombre} className="border-t border-cica-border/30">
                <td className="py-1 text-cica-silver">{g.nombre}</td>
                <td className="text-right text-cica-muted">{g.clientes}</td>
                <td className="text-right" style={{ color: g.vencido > 0 ? "#FF4D6D" : undefined }}>{money(g.vencido)}</td>
                <td className="text-right text-cica-silver">{money(g.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Clientes morosos */}
      <div className="glass p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-cica-muted">Clientes con deuda</div>
          <label className="flex items-center gap-2 text-[11px] text-cica-muted">
            <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} /> solo vencidos
          </label>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-cica-navy/90"><tr className="text-cica-muted"><th className="text-left">Cliente</th><th className="text-left">Barrio</th><th className="text-right">Días</th><th className="text-right">+90</th><th className="text-right px-2">Total</th></tr></thead>
            <tbody>
              {aging.clientes.map((c) => (
                <tr key={c.cliente.id} className="border-t border-cica-border/30">
                  <td className="py-1 text-cica-silver">{c.cliente.codigo} · {c.cliente.nombre}</td>
                  <td className="text-cica-muted">{c.ubicacion.barrio ?? "—"}</td>
                  <td className="text-right" style={{ color: c.maxDias > 60 ? "#FF4D6D" : c.maxDias > 0 ? "#FFB02E" : "#22E0A1" }}>{c.maxDias > 0 ? c.maxDias : "al día"}</td>
                  <td className="text-right text-cica-muted">{c.buckets.d90mas ? money(c.buckets.d90mas) : ""}</td>
                  <td className="text-right px-2 font-semibold text-cica-silver">{money(c.total)}</td>
                </tr>
              ))}
              {aging.clientes.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-cica-muted">Sin cartera pendiente. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function BucketCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-cica-border/40 p-2">
      <div className="text-sm font-bold" style={{ color }}>{money(value)}</div>
      <div className="text-[10px] text-cica-muted">{label}</div>
    </div>
  );
}

/* ===================== Comprobantes ===================== */
function AsientosTab({ canEdit }: { canEdit: boolean }) {
  const [asientos, setAsientos] = useState<AsientoContable[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<AsientoContable | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setAsientos(await listAsientos()); setErr(null); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function reversar(a: AsientoContable) {
    if (!confirm(`¿Reversar el comprobante ${a.numero}? Se creará un asiento inverso (no se borra el original).`)) return;
    try { await reversarAsiento(a.id); await refresh(); } catch (e: any) { alert(e.message); }
  }

  if (loading) return <Cargando />;
  if (err) return <Aviso texto={err} />;
  return (
    <div className="flex flex-col gap-2">
      {asientos.length === 0 && <Aviso texto="Aún no hay comprobantes. Crea el primero en 'Nuevo asiento'." />}
      {asientos.map((a) => (
        <div key={a.id} className="glass p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => setSel(sel?.id === a.id ? null : a)} className="text-left">
              <span className="text-[11px] font-bold text-cica-gold">{a.numero}</span>
              <span className="ml-2 text-[10px] text-cica-muted">{a.fecha?.slice(0, 10)} · {a.tipo}</span>
              <div className="text-sm font-semibold text-white">{a.descripcion}</div>
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-cica-silver">{money(Number(a.debitoTotal))}</span>
              <EstadoBadge estado={a.estado} />
              {canEdit && a.estado === "contabilizado" && (
                <button onClick={() => reversar(a)} className="text-[10px] text-cica-muted hover:text-status-sin">Reversar</button>
              )}
            </div>
          </div>
          {sel?.id === a.id && a.movimientos && (
            <table className="mt-3 w-full text-[11px]">
              <thead><tr className="text-cica-muted"><th className="text-left">Cuenta</th><th className="text-right">Débito</th><th className="text-right">Crédito</th></tr></thead>
              <tbody>
                {a.movimientos.map((m) => (
                  <tr key={m.id} className="border-t border-cica-border/40">
                    <td className="py-1 text-cica-silver">{m.cuentaCodigo} · {m.cuenta?.nombre}{m.tercero ? ` · ${m.tercero.nombre}` : ""}</td>
                    <td className="text-right text-cica-silver">{Number(m.debito) > 0 ? money(Number(m.debito)) : ""}</td>
                    <td className="text-right text-cica-silver">{Number(m.credito) > 0 ? money(Number(m.credito)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

/* ===================== Nuevo asiento ===================== */
function NuevoAsientoTab({ canEdit, onDone }: { canEdit: boolean; onDone: () => void }) {
  const [descripcion, setDescripcion] = useState("");
  const [tipo, setTipo] = useState("manual");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [lineas, setLineas] = useState<(LineaAsiento & { _modo: "debito" | "credito" })[]>([
    { cuenta: "", _modo: "debito", debito: 0 },
    { cuenta: "", _modo: "credito", credito: 0 },
  ]);
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [terceros, setTerceros] = useState<TerceroContable[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listCuentas({ imputables: true }).then(setCuentas).catch(() => {});
    listTercerosContables().then(setTerceros).catch(() => {});
  }, []);

  const cuentaByCodigo = useMemo(() => new Map(cuentas.map((c) => [c.codigo, c])), [cuentas]);
  const totalDebito = lineas.reduce((s, l) => s + (l._modo === "debito" ? Number(l.debito) || 0 : 0), 0);
  const totalCredito = lineas.reduce((s, l) => s + (l._modo === "credito" ? Number(l.credito) || 0 : 0), 0);
  const cuadra = totalDebito === totalCredito && totalDebito > 0;

  function setLinea(i: number, patch: Partial<LineaAsiento & { _modo: "debito" | "credito" }>) {
    setLineas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLinea() { setLineas((ls) => [...ls, { cuenta: "", _modo: "debito", debito: 0 }]); }
  function delLinea(i: number) { setLineas((ls) => ls.filter((_, idx) => idx !== i)); }

  async function guardar() {
    setErr(null);
    const payloadLineas: LineaAsiento[] = lineas.map((l) => ({
      cuenta: l.cuenta,
      debito: l._modo === "debito" ? Number(l.debito) || 0 : undefined,
      credito: l._modo === "credito" ? Number(l.credito) || 0 : undefined,
      terceroId: l.terceroId || undefined,
    }));
    setSaving(true);
    try {
      await crearAsiento({ fecha, tipo, descripcion, lineas: payloadLineas, contabilizar: true });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) return <Aviso texto="No tienes permisos para crear comprobantes." />;

  return (
    <div className="glass p-4">
      {err && <div className="mb-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} /></Field>
        <Field label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={input}>
            {["manual", "venta", "recaudo", "compra", "gasto", "ajuste", "depreciacion", "apertura"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Descripción"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Concepto del comprobante" className={input} /></Field>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">Cuenta (PUC)</th><th>Tercero</th><th className="w-28">Débito</th><th className="w-28">Crédito</th><th></th></tr></thead>
          <tbody>
            {lineas.map((l, i) => {
              const c = cuentaByCodigo.get(l.cuenta);
              return (
                <tr key={i} className="border-t border-cica-border/40">
                  <td className="py-1.5 pr-2">
                    <select value={l.cuenta} onChange={(e) => setLinea(i, { cuenta: e.target.value })} className={`${input} min-w-[200px]`}>
                      <option value="">— cuenta —</option>
                      {cuentas.map((cu) => <option key={cu.codigo} value={cu.codigo}>{cu.codigo} · {cu.nombre}</option>)}
                    </select>
                  </td>
                  <td className="px-1">
                    {c?.exigeTercero ? (
                      <select value={l.terceroId || ""} onChange={(e) => setLinea(i, { terceroId: e.target.value })} className={`${input} min-w-[140px]`}>
                        <option value="">— tercero —</option>
                        {terceros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                      </select>
                    ) : <span className="text-cica-muted">—</span>}
                  </td>
                  <td className="px-1">
                    <input type="number" value={l._modo === "debito" ? l.debito ?? "" : ""} onFocusCapture={() => setLinea(i, { _modo: "debito", credito: 0 })} onChange={(e) => setLinea(i, { _modo: "debito", debito: Number(e.target.value), credito: 0 })} className={`${input} text-right`} />
                  </td>
                  <td className="px-1">
                    <input type="number" value={l._modo === "credito" ? l.credito ?? "" : ""} onFocusCapture={() => setLinea(i, { _modo: "credito", debito: 0 })} onChange={(e) => setLinea(i, { _modo: "credito", credito: Number(e.target.value), debito: 0 })} className={`${input} text-right`} />
                  </td>
                  <td className="px-1 text-center">{lineas.length > 2 && <button onClick={() => delLinea(i)} className="text-cica-muted hover:text-status-sin">✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-cica-border font-bold text-cica-silver">
              <td colSpan={2} className="py-2 text-right">Totales</td>
              <td className="text-right">{money(totalDebito)}</td>
              <td className="text-right">{money(totalCredito)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button onClick={addLinea} className="rounded-lg border border-cica-border px-3 py-1.5 text-xs text-cica-silver hover:border-cica-gold/40">+ Agregar línea</button>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold ${cuadra ? "text-status-ftth" : "text-status-sin"}`}>
            {cuadra ? "✓ Cuadra" : `Descuadre: ${money(totalDebito - totalCredito)}`}
          </span>
          <button onClick={guardar} disabled={!cuadra || saving || descripcion.length < 3} className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">
            {saving ? "Guardando…" : "Contabilizar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== Plan de cuentas ===================== */
function CuentasTab() {
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { listCuentas().then(setCuentas).catch(() => {}); }, []);
  const filtradas = cuentas.filter((c) => !q || c.codigo.startsWith(q) || c.nombre.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código o nombre…" className={`${input} mb-3 max-w-sm`} />
      <div className="glass max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-cica-navy/90"><tr className="text-cica-muted"><th className="px-3 py-2 text-left">Código</th><th className="text-left">Cuenta</th><th>Naturaleza</th><th>Imputable</th></tr></thead>
          <tbody>
            {filtradas.map((c) => (
              <tr key={c.codigo} className="border-t border-cica-border/30">
                <td className={`px-3 py-1 font-mono ${c.imputable ? "text-cica-silver" : "text-cica-muted font-bold"}`}>{c.codigo}</td>
                <td className={c.imputable ? "text-cica-silver" : "text-cica-muted font-semibold"}>{c.nombre}</td>
                <td className="text-center text-cica-muted">{c.naturaleza === "debito" ? "Débito" : "Crédito"}</td>
                <td className="text-center">{c.imputable ? <span className="text-status-ftth">●</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Reportes ===================== */
function ReportesTab() {
  const [rep, setRep] = useState<"balance" | "resultados" | "general">("balance");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    const fn = rep === "balance" ? balanceComprobacion() : rep === "resultados" ? estadoResultados() : balanceGeneral();
    fn.then(setData).catch((e) => setErr(e.message));
  }, [rep]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {([["balance", "Balance de comprobación"], ["resultados", "Estado de resultados"], ["general", "Balance general"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setRep(k)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${rep === k ? "bg-cica-gold/20 text-cica-gold" : "bg-cica-border/30 text-cica-muted hover:text-cica-silver"}`}>{l}</button>
        ))}
      </div>
      {err && <Aviso texto={err} />}
      {!data && !err && <Cargando />}
      {data && rep === "balance" && (
        <div className="glass overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-cica-muted"><th className="px-3 py-2 text-left">Código</th><th className="text-left">Cuenta</th><th className="text-right">Débitos</th><th className="text-right">Créditos</th><th className="text-right">Saldo D</th><th className="text-right px-3">Saldo C</th></tr></thead>
            <tbody>
              {data.filas.map((f: any) => (
                <tr key={f.codigo} className="border-t border-cica-border/30">
                  <td className="px-3 py-1 font-mono text-cica-silver">{f.codigo}</td>
                  <td className="text-cica-silver">{f.nombre}</td>
                  <td className="text-right text-cica-muted">{money(f.debitos)}</td>
                  <td className="text-right text-cica-muted">{money(f.creditos)}</td>
                  <td className="text-right text-cica-silver">{f.saldoDebito ? money(f.saldoDebito) : ""}</td>
                  <td className="text-right px-3 text-cica-silver">{f.saldoCredito ? money(f.saldoCredito) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-cica-border font-bold text-cica-silver"><td colSpan={4} className="px-3 py-2 text-right">Totales saldos</td><td className="text-right">{money(data.totales.saldoDebito)}</td><td className="text-right px-3">{money(data.totales.saldoCredito)}</td></tr></tfoot>
          </table>
          <div className={`px-3 py-2 text-xs font-semibold ${data.cuadra ? "text-status-ftth" : "text-status-sin"}`}>{data.cuadra ? "✓ El balance cuadra" : "⚠ El balance NO cuadra"}</div>
        </div>
      )}
      {data && rep === "resultados" && (
        <div className="glass p-4 text-sm">
          <Row label="Ingresos operacionales" value={money(data.ingresos)} />
          <Row label="(−) Costos" value={money(data.costos)} />
          <Row label="= Utilidad bruta" value={money(data.utilidadBruta)} bold />
          <Row label="(−) Gastos" value={money(data.gastos)} />
          <Row label="= Utilidad neta" value={money(data.utilidadNeta)} bold accent={data.utilidadNeta >= 0 ? "text-status-ftth" : "text-status-sin"} />
        </div>
      )}
      {data && rep === "general" && (
        <div className="glass p-4 text-sm">
          <Row label="ACTIVO" value={money(data.activo)} bold />
          <Row label="PASIVO" value={money(data.pasivo)} />
          <Row label="PATRIMONIO (incl. resultado)" value={money(data.patrimonio)} />
          <Row label="Resultado del ejercicio" value={money(data.resultadoEjercicio)} />
          <Row label="= Pasivo + Patrimonio" value={money(data.pasivoMasPatrimonio)} bold accent={data.cuadra ? "text-status-ftth" : "text-status-sin"} />
          <div className={`mt-2 text-xs font-semibold ${data.cuadra ? "text-status-ftth" : "text-status-sin"}`}>{data.cuadra ? "✓ La ecuación contable cuadra" : "⚠ No cuadra"}</div>
        </div>
      )}
    </div>
  );
}

/* ===================== Periodos ===================== */
function PeriodosTab({ canEdit }: { canEdit: boolean }) {
  const [periodos, setPeriodos] = useState<PeriodoContable[]>([]);
  async function refresh() { try { setPeriodos(await listPeriodos()); } catch { /* noop */ } }
  useEffect(() => { refresh(); }, []);
  async function cerrar(p: string) {
    if (!confirm(`¿Cerrar el periodo ${p}? No se podrán registrar más asientos con fecha en ese mes.`)) return;
    try { await cerrarPeriodo(p); await refresh(); } catch (e: any) { alert(e.message); }
  }
  return (
    <div className="flex flex-col gap-2">
      {periodos.length === 0 && <Aviso texto="No hay periodos abiertos. Se crean automáticamente al registrar el primer asiento de un mes." />}
      {periodos.map((p) => (
        <div key={p.periodo} className="glass flex items-center justify-between p-3">
          <span className="font-semibold text-cica-silver">{p.periodo}</span>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold ${p.estado === "abierto" ? "text-status-ftth" : "text-cica-muted"}`}>{p.estado}</span>
            {canEdit && p.estado === "abierto" && <button onClick={() => cerrar(p.periodo)} className="rounded-lg border border-cica-border px-3 py-1 text-xs text-cica-silver hover:border-cica-gold/40">Cerrar mes</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===================== Helpers ===================== */
const input = "rounded-lg border border-cica-border bg-cica-panel px-3 py-2 text-sm text-cica-silver placeholder:text-cica-muted focus:border-cica-gold focus:outline-none";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-cica-muted">{label}</span>{children}</label>;
}
function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className="glass p-4"><div className={`text-2xl font-extrabold ${accent}`}>{value}</div><div className="mt-0.5 text-[11px] text-cica-silver">{label}</div></div>;
}
function EstadoBadge({ estado }: { estado: string }) {
  const m: Record<string, { c: string; bg: string }> = {
    contabilizado: { c: "#22E0A1", bg: "rgba(34,224,161,0.15)" },
    borrador: { c: "#FFB02E", bg: "rgba(255,176,46,0.15)" },
    anulado: { c: "#FF4D6D", bg: "rgba(255,77,109,0.15)" },
  };
  const s = m[estado] ?? m.borrador;
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: s.c, background: s.bg }}>{estado}</span>;
}
function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: string }) {
  return <div className={`flex justify-between border-b border-cica-border/30 py-1.5 ${bold ? "font-bold" : ""}`}><span className="text-cica-silver">{label}</span><span className={accent ?? "text-cica-silver"}>{value}</span></div>;
}
function Cargando() { return <div className="grid place-items-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" /></div>; }
function Aviso({ texto }: { texto: string }) { return <div className="glass p-6 text-center text-sm text-cica-muted">{texto}</div>; }
