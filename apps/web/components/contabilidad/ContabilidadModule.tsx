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
  situacionNiif,
  listPeriodos,
  cerrarPeriodo,
  getAging,
  getAgingPorZona,
  billingPreview,
  billingRun,
  suspenderMorosos,
  listCuentasBancarias,
  crearCuentaBancaria,
  importarExtracto,
  movimientosSinConciliar,
  bankingResumen,
  conciliarMovimiento,
  ignorarMovimiento,
  dunningPreview,
  dunningRun,
  listCompras,
  comprasResumen,
  crearCompra,
  pagarCompra,
  listReglasImpuesto,
  calcularImpuestos,
  downloadFile,
  listActivosFijos,
  crearActivoFijo,
  depreciacionPreview,
  depreciacionRun,
  listFormatosExogena,
  generarExogena,
  listEmpleados,
  crearEmpleado,
  nominaPreview,
  nominaRun,
  listRecibos,
  cashResumen,
  facturasPendientesCliente,
  crearRecibo,
  aplicarSaldoRecibo,
  anularRecibo,
  listClientes,
  type AsientoContable,
  type CuentaContable,
  type TerceroContable,
  type LineaAsiento,
  type PeriodoContable,
  type Aging,
  type AgingZona,
  type BillingPreview as BillingPreviewT,
  type CuentaBancaria,
  type MovimientoBancario,
  type DunningPreview as DunningPreviewT,
  type FacturaCompra,
  type LineaCompra,
  type ActivoFijo,
  type FormatoExogena,
  type Empleado,
  type ReciboCaja,
  type FacturaPendiente,
} from "../../lib/api";

type Tab = "dashboard" | "cartera" | "recibos" | "facturacion" | "cobranza" | "compras" | "activos" | "nomina" | "exogena" | "bancos" | "asientos" | "nuevo" | "cuentas" | "reportes" | "periodos";

const money = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

const TABS: { key: Tab; label: string; soloAdmin?: boolean }[] = [
  { key: "dashboard", label: "Resumen" },
  { key: "cartera", label: "Cartera" },
  { key: "recibos", label: "Recibos de caja" },
  { key: "cobranza", label: "Cobranza" },
  { key: "facturacion", label: "Facturación", soloAdmin: true },
  { key: "compras", label: "Compras / CxP" },
  { key: "activos", label: "Activos" },
  { key: "nomina", label: "Nómina" },
  { key: "exogena", label: "Exógena" },
  { key: "bancos", label: "Bancos" },
  { key: "asientos", label: "Comprobantes" },
  { key: "nuevo", label: "Nuevo asiento" },
  { key: "cuentas", label: "Plan de cuentas" },
  { key: "reportes", label: "Reportes" },
  { key: "periodos", label: "Periodos" },
];

export default function ContabilidadModule({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const tabs = TABS.filter((t) => !t.soloAdmin || isAdmin);
  return (
    <div className="mx-auto max-w-6xl">
      <h2 className="mb-1 text-xl font-extrabold text-white">Contabilidad</h2>
      <p className="mb-4 text-xs text-cica-muted">Libros, cartera y reportes financieros de CICANET (PUC Colombia, doble partida).</p>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-cica-border/60 pb-2">
        {tabs.map((t) => (
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
      {tab === "recibos" && <RecibosTab canEdit={canEdit} />}
      {tab === "cobranza" && <CobranzaTab isAdmin={isAdmin} />}
      {tab === "facturacion" && <FacturacionTab />}
      {tab === "compras" && <ComprasTab canEdit={canEdit} />}
      {tab === "activos" && <ActivosTab isAdmin={isAdmin} />}
      {tab === "nomina" && <NominaTab isAdmin={isAdmin} />}
      {tab === "exogena" && <ExogenaTab />}
      {tab === "bancos" && <BancosTab />}
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

/* ===================== Nómina ===================== */
function NominaTab({ isAdmin }: { isAdmin: boolean }) {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const ahora = new Date();
  const [periodo, setPeriodo] = useState(`${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`);
  const [prev, setPrev] = useState<{ empleados: number; totalDevengado: number; totalNeto: number } | null>(null);
  const [nombre, setNombre] = useState(""); const [doc, setDoc] = useState(""); const [salario, setSalario] = useState(0);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  async function refresh() { try { setEmpleados(await listEmpleados()); setPrev(await nominaPreview(periodo)); setErr(null); } catch (e: any) { setErr(e.message); } }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [periodo]);

  async function crear() {
    if (!nombre || !doc || salario <= 0) return;
    setBusy(true);
    try { await crearEmpleado({ nombre, documento: doc, salarioBase: salario }); setNombre(""); setDoc(""); setSalario(0); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function correr() {
    if (!confirm(`¿Liquidar la nómina de ${periodo}? Genera asientos por cada empleado.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await nominaRun(periodo); setMsg(`Nómina ${periodo}: ${r.liquidados} empleado(s), neto ${money(r.totalNeto)}.`); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="glass p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Periodo"><input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={input} /></Field>
          {prev && <div className="text-xs text-cica-muted">Por liquidar: <b className="text-cica-gold">{prev.empleados}</b> · devengado {money(prev.totalDevengado)} · neto {money(prev.totalNeto)}</div>}
          {isAdmin && <button onClick={correr} disabled={busy || !prev?.empleados} className="ml-auto rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">Liquidar nómina</button>}
        </div>
        {msg && <div className="mt-3 rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-2 text-xs text-status-ftth">{msg}</div>}
        {err && <div className="mt-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}
        <p className="mt-2 text-[10px] text-cica-muted">La emisión del documento de nómina electrónica ante la DIAN se habilita al cargar los certificados de CICANET (vía einvoice).</p>
      </div>

      {isAdmin && (
        <div className="glass p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Registrar empleado</div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={input} /></Field>
            <Field label="Documento"><input value={doc} onChange={(e) => setDoc(e.target.value)} className={input} /></Field>
            <Field label="Salario base"><input type="number" value={salario || ""} onChange={(e) => setSalario(Number(e.target.value))} className={input} /></Field>
            <button onClick={crear} disabled={busy} className="rounded-lg border border-cica-border px-3 py-2 text-xs text-cica-silver hover:border-cica-gold/40">+ Empleado</button>
          </div>
        </div>
      )}

      <div className="glass p-4">
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">Empleado</th><th className="text-left">Cargo</th><th className="text-right">Salario</th><th className="text-right">Estado</th></tr></thead>
          <tbody>
            {empleados.map((e) => (
              <tr key={e.id} className="border-t border-cica-border/30">
                <td className="py-1 text-cica-silver">{e.nombre} · {e.documento}</td>
                <td className="text-cica-muted">{e.cargo ?? "—"}</td>
                <td className="text-right text-cica-silver">{money(Number(e.salarioBase))}</td>
                <td className="text-right"><span className={`text-[11px] ${e.estado === "activo" ? "text-status-ftth" : "text-cica-muted"}`}>{e.estado}</span></td>
              </tr>
            ))}
            {empleados.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-cica-muted">Sin empleados registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Información exógena ===================== */
function ExogenaTab() {
  const [formatos, setFormatos] = useState<FormatoExogena[]>([]);
  const [formato, setFormato] = useState("1007");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState<{ nombre: string; terceros: number; total: number; filas: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { listFormatosExogena().then(setFormatos).catch(() => {}); }, []);
  useEffect(() => { setData(null); generarExogena(formato, anio).then(setData).catch((e) => setErr(e.message)); }, [formato, anio]);

  return (
    <div className="flex flex-col gap-4">
      <div className="glass p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Formato DIAN">
            <select value={formato} onChange={(e) => setFormato(e.target.value)} className={`${input} min-w-[280px]`}>
              {formatos.map((f) => <option key={f.codigo} value={f.codigo}>{f.codigo} · {f.nombre}</option>)}
            </select>
          </Field>
          <Field label="Año"><input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} className={`${input} w-28`} /></Field>
          <button onClick={() => downloadFile(`/exogena/${formato}/csv?anio=${anio}`, `exogena-${formato}-${anio}.csv`).catch((e) => alert(e.message))} className="rounded-lg border border-cica-border px-3 py-2 text-xs text-cica-silver hover:border-cica-gold/40">Exportar (Excel)</button>
        </div>
        <p className="mt-2 text-[10px] text-cica-muted">Borrador derivado del ledger por tercero. La contadora revisa y ajusta conceptos antes de presentar a la DIAN.</p>
      </div>

      {err && <Aviso texto={err} />}
      {data && (
        <div className="glass p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-white">{data.nombre} · {anio}</div>
            <div className="text-sm font-bold text-cica-gold">{money(data.total)} · {data.terceros} tercero(s)</div>
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cica-navy/90"><tr className="text-cica-muted"><th className="text-left">Tipo</th><th className="text-left">NIT/Doc</th><th className="text-left">Nombre</th><th className="text-right px-2">Valor</th></tr></thead>
              <tbody>
                {data.filas.map((f, i) => (
                  <tr key={i} className="border-t border-cica-border/30">
                    <td className="py-1 text-cica-muted">{f.tipoDocumento}</td>
                    <td className="text-cica-silver">{f.nit}{f.dv ? `-${f.dv}` : ""}</td>
                    <td className="text-cica-silver">{f.nombre}</td>
                    <td className="text-right px-2 text-cica-silver">{money(f.valor)}</td>
                  </tr>
                ))}
                {data.filas.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-cica-muted">Sin datos para este formato/año.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== Activos fijos / Depreciación ===================== */
function ActivosTab({ isAdmin }: { isAdmin: boolean }) {
  const [activos, setActivos] = useState<ActivoFijo[]>([]);
  const [nombre, setNombre] = useState("");
  const [valor, setValor] = useState(0);
  const [vida, setVida] = useState(60);
  const ahora = new Date();
  const [periodo, setPeriodo] = useState(`${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`);
  const [prev, setPrev] = useState<{ activos: number; totalDepreciacion: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setActivos(await listActivosFijos()); setPrev(await depreciacionPreview(periodo)); setErr(null); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [periodo]);

  async function crear() {
    if (!nombre || valor <= 0 || vida <= 0) return;
    setBusy(true); setErr(null);
    try { await crearActivoFijo({ nombre, valorAdquisicion: valor, vidaUtilMeses: vida }); setNombre(""); setValor(0); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function correr() {
    if (!confirm(`¿Correr la depreciación de ${periodo}? Genera asientos por cada activo.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await depreciacionRun(periodo); setMsg(`Depreciación ${periodo}: ${r.procesados} activo(s), total ${money(r.totalDepreciacion)}.`); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="glass p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Periodo"><input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={input} /></Field>
          {prev && <div className="text-xs text-cica-muted">Por depreciar en {periodo}: <b className="text-cica-gold">{money(prev.totalDepreciacion)}</b> ({prev.activos} activo/s)</div>}
          {isAdmin && <button onClick={correr} disabled={busy || !prev?.activos} className="ml-auto rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">Correr depreciación</button>}
        </div>
        {msg && <div className="mt-3 rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-2 text-xs text-status-ftth">{msg}</div>}
        {err && <div className="mt-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}
      </div>

      {isAdmin && (
        <div className="glass p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Registrar activo fijo</div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="OLT / Switch / Vehículo" className={input} /></Field>
            <Field label="Valor"><input type="number" value={valor || ""} onChange={(e) => setValor(Number(e.target.value))} className={input} /></Field>
            <Field label="Vida útil (meses)"><input type="number" value={vida} onChange={(e) => setVida(Number(e.target.value))} className={`${input} w-28`} /></Field>
            <button onClick={crear} disabled={busy} className="rounded-lg border border-cica-border px-3 py-2 text-xs text-cica-silver hover:border-cica-gold/40">+ Activo</button>
          </div>
        </div>
      )}

      <div className="glass p-4">
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">Activo</th><th className="text-right">Valor</th><th className="text-right">Dep. acumulada</th><th className="text-right">Vida</th><th className="text-right">Estado</th></tr></thead>
          <tbody>
            {activos.map((a) => (
              <tr key={a.id} className="border-t border-cica-border/30">
                <td className="py-1 text-cica-silver">{a.nombre}</td>
                <td className="text-right text-cica-silver">{money(Number(a.valorAdquisicion))}</td>
                <td className="text-right text-cica-muted">{money(Number(a.depreciacionAcumulada))}</td>
                <td className="text-right text-cica-muted">{a.vidaUtilMeses}m</td>
                <td className="text-right"><span className={`text-[11px] ${a.estado === "depreciado" ? "text-cica-muted" : "text-status-ftth"}`}>{a.estado}</span></td>
              </tr>
            ))}
            {activos.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-cica-muted">Sin activos fijos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Compras / Cuentas por pagar ===================== */
function ComprasTab({ canEdit }: { canEdit: boolean }) {
  const [compras, setCompras] = useState<FacturaCompra[]>([]);
  const [resumen, setResumen] = useState<{ totalPorPagar: number; vencido: number; facturasPendientes: number } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setCompras(await listCompras()); setResumen(await comprasResumen()); setErr(null); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function pagar(c: FacturaCompra) {
    if (!confirm(`¿Registrar el pago de ${c.numero} por ${money(Number(c.totalAPagar))}?`)) return;
    setBusy(true);
    try { await pagarCompra(c.id); await refresh(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Por pagar" value={money(resumen?.totalPorPagar ?? 0)} accent="text-cica-gold" />
        <Kpi label="Vencido" value={money(resumen?.vencido ?? 0)} accent={(resumen?.vencido ?? 0) > 0 ? "text-status-sin" : "text-cica-silver"} />
        <Kpi label="Facturas pendientes" value={String(resumen?.facturasPendientes ?? 0)} accent="text-cica-steelLight" />
      </div>

      {canEdit && (
        <div>
          <button onClick={() => setShowForm(true)} className="rounded-xl bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black">+ Registrar compra/gasto</button>
        </div>
      )}
      {err && <Aviso texto={err} />}

      <div className="glass p-4">
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">N°</th><th className="text-left">Proveedor</th><th className="text-left">Concepto</th><th className="text-right">Total</th><th className="text-right">Estado</th></tr></thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id} className="border-t border-cica-border/30">
                <td className="py-1 font-mono text-cica-gold">{c.numero}</td>
                <td className="text-cica-silver">{c.proveedorNombre}</td>
                <td className="text-cica-muted">{c.concepto}</td>
                <td className="text-right font-semibold text-cica-silver">{money(Number(c.totalAPagar))}</td>
                <td className="text-right">
                  {c.estado === "pendiente" && canEdit
                    ? <button onClick={() => pagar(c)} disabled={busy} className="rounded border border-cica-border px-2 py-0.5 text-[11px] text-cica-gold hover:bg-cica-gold/10">Pagar</button>
                    : <span className={`text-[11px] ${c.estado === "pagada" ? "text-status-ftth" : "text-cica-muted"}`}>{c.estado}</span>}
                </td>
              </tr>
            ))}
            {compras.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-cica-muted">Sin compras registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <CompraForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />}
    </div>
  );
}

function CompraForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [docProv, setDocProv] = useState("");
  const [nomProv, setNomProv] = useState("");
  const [concepto, setConcepto] = useState("");
  const [venc, setVenc] = useState(new Date().toISOString().slice(0, 10));
  const [lineas, setLineas] = useState<LineaCompra[]>([{ cuenta: "", base: 0, ivaPct: 0 }]);
  const [retefuente, setRetefuente] = useState(0);
  const [reteIva, setReteIva] = useState(0);
  const [reteIca, setReteIca] = useState(0);
  const [rfConcepto, setRfConcepto] = useState("");
  const [aplicarReteIva, setAplicarReteIva] = useState(false);
  const [aplicarReteIca, setAplicarReteIca] = useState(false);
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { listCuentas({ imputables: true }).then((cs) => setCuentas(cs.filter((c) => c.clase === 5 || c.clase === 6 || c.clase === 1))).catch(() => {}); }, []);

  const subtotal = lineas.reduce((s, l) => s + (Number(l.base) || 0), 0);
  const iva = lineas.reduce((s, l) => s + (Number(l.base) || 0) * ((Number(l.ivaPct) || 0) / 100), 0);
  const total = subtotal + iva - retefuente - reteIva - reteIca;

  function setL(i: number, patch: Partial<LineaCompra>) { setLineas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }

  async function sugerir() {
    try {
      const r = await calcularImpuestos({
        base: subtotal,
        ivaMonto: iva,
        retefuenteCodigo: rfConcepto || undefined,
        aplicarReteIva,
        reteIcaCodigo: aplicarReteIca ? "reteica_966" : undefined,
      });
      setRetefuente(r.retefuente); setReteIva(r.reteIva); setReteIca(r.reteIca);
    } catch (e: any) { setErr(e.message); }
  }

  async function guardar() {
    setErr(null); setSaving(true);
    try {
      await crearCompra({
        proveedor: { documento: docProv.trim(), nombre: nomProv.trim() },
        concepto, fechaVencimiento: venc,
        lineas: lineas.filter((l) => l.cuenta && Number(l.base) > 0),
        retefuente, reteIva, reteIca,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }

  const valido = docProv && nomProv && concepto.length >= 3 && lineas.some((l) => l.cuenta && Number(l.base) > 0);

  return (
    <Modal title="Registrar compra / gasto" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {err && <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="NIT/Doc proveedor"><input value={docProv} onChange={(e) => setDocProv(e.target.value)} className={input} /></Field>
          <Field label="Nombre proveedor"><input value={nomProv} onChange={(e) => setNomProv(e.target.value)} className={input} /></Field>
        </div>
        <Field label="Concepto"><input value={concepto} onChange={(e) => setConcepto(e.target.value)} className={input} /></Field>
        <Field label="Vence"><input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} className={input} /></Field>

        <div className="text-[11px] font-bold uppercase tracking-wide text-cica-muted">Líneas (gasto/activo)</div>
        {lineas.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select value={l.cuenta} onChange={(e) => setL(i, { cuenta: e.target.value })} className={`${input} col-span-6`}>
              <option value="">— cuenta —</option>
              {cuentas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
            </select>
            <input type="number" placeholder="base" value={l.base || ""} onChange={(e) => setL(i, { base: Number(e.target.value) })} className={`${input} col-span-3 text-right`} />
            <select value={l.ivaPct ?? 0} onChange={(e) => setL(i, { ivaPct: Number(e.target.value) })} className={`${input} col-span-2`}>
              <option value={0}>0%</option><option value={5}>5%</option><option value={19}>19%</option>
            </select>
            <button onClick={() => setLineas((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls)} className="col-span-1 text-cica-muted hover:text-status-sin">✕</button>
          </div>
        ))}
        <button onClick={() => setLineas((ls) => [...ls, { cuenta: "", base: 0, ivaPct: 0 }])} className="self-start rounded-lg border border-cica-border px-3 py-1 text-xs text-cica-silver">+ Línea</button>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-cica-border/40 p-3">
          <Field label="Concepto retefuente">
            <select value={rfConcepto} onChange={(e) => setRfConcepto(e.target.value)} className={input}>
              <option value="">Sin retefuente</option>
              <option value="rf_compras">Compras 2.5%</option>
              <option value="rf_servicios">Servicios 4%</option>
              <option value="rf_servicios6">Servicios 6%</option>
              <option value="rf_honorarios">Honorarios 11%</option>
            </select>
          </Field>
          <label className="flex items-center gap-1 text-[11px] text-cica-muted"><input type="checkbox" checked={aplicarReteIva} onChange={(e) => setAplicarReteIva(e.target.checked)} /> ReteIVA</label>
          <label className="flex items-center gap-1 text-[11px] text-cica-muted"><input type="checkbox" checked={aplicarReteIca} onChange={(e) => setAplicarReteIca(e.target.checked)} /> ReteICA</label>
          <button onClick={sugerir} className="rounded-lg border border-cica-gold/40 px-3 py-1.5 text-xs font-semibold text-cica-gold hover:bg-cica-gold/10">Sugerir retenciones</button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Retefuente"><input type="number" value={retefuente || ""} onChange={(e) => setRetefuente(Number(e.target.value))} className={input} /></Field>
          <Field label="ReteIVA"><input type="number" value={reteIva || ""} onChange={(e) => setReteIva(Number(e.target.value))} className={input} /></Field>
          <Field label="ReteICA"><input type="number" value={reteIca || ""} onChange={(e) => setReteIca(Number(e.target.value))} className={input} /></Field>
        </div>

        <div className="rounded-lg bg-cica-border/20 p-3 text-xs">
          <Row label="Subtotal" value={money(subtotal)} />
          <Row label="IVA descontable" value={money(iva)} />
          <Row label="(−) Retenciones" value={money(retefuente + reteIva + reteIca)} />
          <Row label="Total a pagar" value={money(total)} bold accent="text-cica-gold" />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-cica-muted">Cancelar</button>
          <button onClick={guardar} disabled={!valido || saving} className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">{saving ? "Guardando…" : "Causar compra"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ===================== Recibos de caja (cash application) ===================== */
function RecibosTab({ canEdit }: { canEdit: boolean }) {
  const [recibos, setRecibos] = useState<ReciboCaja[]>([]);
  const [resumen, setResumen] = useState<{ recibosPendientes: number; totalPorAplicar: number; huerfanos: number } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setRecibos(await listRecibos()); setResumen(await cashResumen()); setErr(null); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function anular(r: ReciboCaja) {
    if (!confirm(`¿Anular el recibo ${r.numero}? Se reversan los asientos y se reabren las facturas.`)) return;
    setBusy(true);
    try { await anularRecibo(r.id); await refresh(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Recibos por aplicar" value={String(resumen?.recibosPendientes ?? 0)} accent="text-cica-gold" />
        <Kpi label="Saldo por aplicar" value={money(resumen?.totalPorAplicar ?? 0)} accent="text-status-parcial" />
        <Kpi label="Sin identificar" value={String(resumen?.huerfanos ?? 0)} accent={(resumen?.huerfanos ?? 0) > 0 ? "text-status-sin" : "text-cica-muted"} />
      </div>

      {canEdit && <div><button onClick={() => setShowForm(true)} className="rounded-xl bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black">+ Registrar recibo de caja</button></div>}
      {err && <Aviso texto={err} />}

      <div className="glass p-4">
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">N°</th><th className="text-left">Cliente</th><th className="text-left">Medio</th><th className="text-right">Recibido</th><th className="text-right">Sin aplicar</th><th className="text-right">Estado</th></tr></thead>
          <tbody>
            {recibos.map((r) => (
              <tr key={r.id} className="border-t border-cica-border/30">
                <td className="py-1 font-mono text-cica-gold">{r.numero}</td>
                <td className="text-cica-silver">{r.clienteNombre ?? <span className="text-status-sin">Sin identificar</span>}</td>
                <td className="text-cica-muted">{r.medioPago}</td>
                <td className="text-right text-cica-silver">{money(Number(r.montoRecibido))}</td>
                <td className="text-right text-cica-muted">{Number(r.saldoPorAplicar) > 0 ? money(Number(r.saldoPorAplicar)) : ""}</td>
                <td className="text-right">
                  <span className={`text-[11px] ${r.estado === "aplicado" ? "text-status-ftth" : r.estado === "anulado" ? "text-cica-muted" : "text-status-parcial"}`}>{r.estado}</span>
                  {canEdit && r.estado !== "anulado" && <button onClick={() => anular(r)} disabled={busy} className="ml-2 text-[10px] text-cica-muted hover:text-status-sin">anular</button>}
                </td>
              </tr>
            ))}
            {recibos.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-cica-muted">Sin recibos registrados.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <ReciboForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />}
    </div>
  );
}

function ReciboForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [clientes, setClientes] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null);
  const [medio, setMedio] = useState("transferencia");
  const [monto, setMonto] = useState(0);
  const [referencia, setReferencia] = useState("");
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [aplic, setAplic] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function buscar() {
    try { const r: any = await listClientes({ q }); setClientes(Array.isArray(r) ? r : r.items ?? []); } catch { /* noop */ }
  }
  async function elegir(c: { id: string; nombre: string }) {
    setCliente(c); setClientes([]);
    try { setFacturas(await facturasPendientesCliente(c.id)); } catch { setFacturas([]); }
  }
  function aplicarAuto() {
    let resto = monto; const next: Record<string, number> = {};
    for (const f of facturas) { if (resto <= 0) break; const m = Math.min(resto, f.saldo); next[f.id] = m; resto = Math.round((resto - m) * 100) / 100; }
    setAplic(next);
  }
  const totalAplicado = Object.values(aplic).reduce((s, v) => s + (Number(v) || 0), 0);

  async function guardar() {
    setErr(null); setSaving(true);
    try {
      const aplicaciones = Object.entries(aplic).filter(([, m]) => Number(m) > 0).map(([facturaId, m]) => ({ facturaId, monto: Number(m) }));
      await crearRecibo({ clienteId: cliente?.id, medioPago: medio, montoRecibido: monto, referencia: referencia || undefined, aplicaciones });
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }

  const valido = monto > 0 && totalAplicado <= monto + 0.5;

  return (
    <Modal title="Registrar recibo de caja" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {err && <div className="rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}

        {!cliente ? (
          <div>
            <Field label="Cliente (buscar por nombre/documento)">
              <div className="flex gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} className={input} />
                <button onClick={buscar} className="rounded-lg border border-cica-border px-3 text-xs text-cica-silver">Buscar</button>
              </div>
            </Field>
            {clientes.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-cica-border/40">
                {clientes.map((c) => <button key={c.id} onClick={() => elegir(c)} className="block w-full px-3 py-1.5 text-left text-xs text-cica-silver hover:bg-cica-border/30">{c.codigo} · {c.nombre}</button>)}
              </div>
            )}
            <button onClick={() => setCliente({ id: "", nombre: "" })} className="mt-2 text-[11px] text-cica-muted hover:text-cica-silver">Continuar sin identificar →</button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-cica-border/20 px-3 py-2">
            <span className="text-sm text-cica-silver">{cliente.id ? cliente.nombre : "Sin identificar"}</span>
            <button onClick={() => { setCliente(null); setFacturas([]); setAplic({}); }} className="text-[11px] text-cica-muted hover:text-status-sin">cambiar</button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Field label="Medio"><select value={medio} onChange={(e) => setMedio(e.target.value)} className={input}>{["transferencia", "efectivo", "wompi", "nequi", "consignacion", "tarjeta"].map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
          <Field label="Monto recibido"><input type="number" value={monto || ""} onChange={(e) => setMonto(Number(e.target.value))} className={input} /></Field>
          <Field label="Referencia"><input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={input} /></Field>
        </div>

        {cliente?.id && facturas.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-cica-muted">Aplicar a facturas</span>
              <button onClick={aplicarAuto} className="text-[11px] text-cica-gold hover:underline">aplicar automático (más antigua primero)</button>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-cica-muted"><th className="text-left">Periodo</th><th className="text-right">Saldo</th><th className="text-right w-32">Aplicar</th></tr></thead>
              <tbody>
                {facturas.map((f) => (
                  <tr key={f.id} className="border-t border-cica-border/30">
                    <td className="py-1 text-cica-silver">{f.periodo}</td>
                    <td className="text-right text-cica-muted">{money(f.saldo)}</td>
                    <td className="text-right"><input type="number" value={aplic[f.id] ?? ""} onChange={(e) => setAplic({ ...aplic, [f.id]: Number(e.target.value) })} className={`${input} text-right`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg bg-cica-border/20 p-2 text-xs">
          <span className="text-cica-muted">Aplicado: <b className="text-cica-silver">{money(totalAplicado)}</b> · Saldo (anticipo): <b className="text-cica-silver">{money(Math.max(0, monto - totalAplicado))}</b></span>
          {totalAplicado > monto + 0.5 && <span className="text-status-sin">Excede el monto recibido</span>}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-cica-muted">Cancelar</button>
          <button onClick={guardar} disabled={!valido || saving} className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">{saving ? "Guardando…" : "Registrar recibo"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ===================== Cobranza (dunning) ===================== */
function CobranzaTab({ isAdmin }: { isAdmin: boolean }) {
  const [pv, setPv] = useState<DunningPreviewT | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() { try { setPv(await dunningPreview()); setErr(null); } catch (e: any) { setErr(e.message); } }
  useEffect(() => { refresh(); }, []);

  async function ejecutar(aplicar: boolean) {
    if (aplicar && !confirm("¿Enviar los recordatorios de cobro por WhatsApp ahora?")) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await dunningRun(aplicar);
      setMsg(aplicar ? `Enviados ${r.enviados}, fallidos ${r.fallidos}, omitidos ${r.omitidos}.` : `Simulación: ${r.detalle.length} mensajes listos para enviar.`);
      refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err) return <Aviso texto={err} />;
  if (!pv) return <Cargando />;

  return (
    <div className="flex flex-col gap-4">
      <div className="glass p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-white">Cobranza automática por WhatsApp</div>
            <div className="text-xs text-cica-muted">Mes {pv.mes} · {pv.aEnviar} mensaje(s) por enviar de {pv.total} cliente(s) con deuda</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => ejecutar(false)} disabled={busy} className="rounded-lg border border-cica-border px-3 py-2 text-xs text-cica-silver hover:border-cica-gold/40">Simular</button>
            {isAdmin && <button onClick={() => ejecutar(true)} disabled={busy || pv.aEnviar === 0} className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">Enviar recordatorios</button>}
          </div>
        </div>
        {msg && <div className="mt-3 rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-2 text-xs text-status-ftth">{msg}</div>}
      </div>

      <div className="glass p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Destinatarios</div>
        <div className="flex flex-col gap-2">
          {pv.objetivos.map((o) => (
            <div key={o.clienteId} className="rounded-lg border border-cica-border/40 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-cica-silver">{o.nombre}</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-cica-border/40 px-2 py-0.5 text-[10px] text-cica-muted">{o.bucket} · {o.dias}d</span>
                  {o.yaEnviado && <span className="text-[10px] text-status-ftth">enviado ✓</span>}
                  {!o.telefono && <span className="text-[10px] text-status-sin">sin teléfono</span>}
                  {!o.habilitado && <span className="text-[10px] text-cica-muted">regla off</span>}
                </div>
              </div>
              <div className="mt-1 text-[11px] italic text-cica-muted">{o.mensaje}</div>
            </div>
          ))}
          {pv.objetivos.length === 0 && <p className="text-center text-xs text-cica-muted">No hay clientes con deuda para cobrar. ✓</p>}
        </div>
      </div>
    </div>
  );
}

/* ===================== Bancos / Conciliación ===================== */
function BancosTab() {
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [cuenta, setCuenta] = useState<string>("");
  const [movs, setMovs] = useState<MovimientoBancario[]>([]);
  const [resumen, setResumen] = useState<{ total: number; sinConciliar: number; conciliados: number; montoSinConciliar: number } | null>(null);
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nueva, setNueva] = useState({ nombre: "", banco: "", cuentaPuc: "111005" });
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const cs = await listCuentasBancarias();
    setCuentas(cs);
    if (!cuenta && cs[0]) setCuenta(cs[0].id);
    const cid = cuenta || cs[0]?.id;
    if (cid) {
      setMovs(await movimientosSinConciliar(cid));
      setResumen(await bankingResumen(cid));
    }
  }
  useEffect(() => { refresh().catch((e) => setErr(e.message)); /* eslint-disable-next-line */ }, [cuenta]);

  async function crearCuenta() {
    if (!nueva.nombre || !nueva.cuentaPuc) return;
    setBusy(true); setErr(null);
    try { await crearCuentaBancaria(nueva); setNueva({ nombre: "", banco: "", cuentaPuc: "111005" }); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function importar() {
    if (!cuenta || !csv.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await importarExtracto(cuenta, csv); setMsg(`Importados ${r.importados}, duplicados ${r.duplicados}, errores ${r.errores.length}.`); setCsv(""); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function conciliar(m: MovimientoBancario) {
    const entrada = Number(m.valor) > 0;
    const def = entrada ? "111505" : "530515";
    const contrapartida = prompt(`Cuenta contrapartida (PUC) para "${m.descripcion}":`, def);
    if (!contrapartida) return;
    setBusy(true); setErr(null);
    try { const r = await conciliarMovimiento(m.id, { contrapartida }); setMsg(`Conciliado → comprobante ${r.asiento}.`); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function ignorar(m: MovimientoBancario) {
    setBusy(true);
    try { await ignorarMovimiento(m.id); await refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Cuentas + alta */}
      <div className="glass p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Cuenta bancaria">
            <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={input}>
              {cuentas.length === 0 && <option value="">— crea una cuenta —</option>}
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.cuentaPuc})</option>)}
            </select>
          </Field>
          {resumen && (
            <div className="flex gap-4 text-xs">
              <span className="text-cica-muted">Sin conciliar: <b className="text-status-parcial">{resumen.sinConciliar}</b></span>
              <span className="text-cica-muted">Conciliados: <b className="text-status-ftth">{resumen.conciliados}</b></span>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-cica-border/40 pt-3">
          <Field label="Nueva cuenta"><input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Bancolombia corriente" className={input} /></Field>
          <Field label="PUC"><input value={nueva.cuentaPuc} onChange={(e) => setNueva({ ...nueva, cuentaPuc: e.target.value })} className={`${input} w-24`} /></Field>
          <button onClick={crearCuenta} disabled={busy} className="rounded-lg border border-cica-border px-3 py-2 text-xs text-cica-silver hover:border-cica-gold/40">+ Cuenta</button>
        </div>
      </div>

      {/* Importar extracto */}
      <div className="glass p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Importar extracto (CSV: fecha; descripción; valor; referencia)</div>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} placeholder="2026-06-18;Recaudo Wompi;135000;WP-001" className={`${input} w-full font-mono`} />
        <div className="mt-2 flex items-center justify-between">
          {msg && <span className="text-xs text-status-ftth">{msg}</span>}
          {err && <span className="text-xs text-status-sin">{err}</span>}
          <button onClick={importar} disabled={busy || !cuenta || !csv.trim()} className="ml-auto rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">Importar</button>
        </div>
      </div>

      {/* Movimientos sin conciliar */}
      <div className="glass p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Sin conciliar ({movs.length})</div>
        <table className="w-full text-xs">
          <thead><tr className="text-cica-muted"><th className="text-left">Fecha</th><th className="text-left">Descripción</th><th className="text-right">Valor</th><th></th></tr></thead>
          <tbody>
            {movs.map((m) => (
              <tr key={m.id} className="border-t border-cica-border/30">
                <td className="py-1 text-cica-muted">{m.fecha?.slice(0, 10)}</td>
                <td className="text-cica-silver">{m.descripcion}{m.referencia ? ` · ${m.referencia}` : ""}</td>
                <td className="text-right font-semibold" style={{ color: Number(m.valor) >= 0 ? "#22E0A1" : "#FF4D6D" }}>{money(Number(m.valor))}</td>
                <td className="text-right">
                  <button onClick={() => conciliar(m)} disabled={busy} className="rounded border border-cica-border px-2 py-0.5 text-[11px] text-cica-gold hover:bg-cica-gold/10">Conciliar</button>
                  <button onClick={() => ignorar(m)} disabled={busy} className="ml-1 text-[10px] text-cica-muted hover:text-status-sin">ignorar</button>
                </td>
              </tr>
            ))}
            {movs.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-cica-muted">No hay movimientos sin conciliar. ✓</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== Facturación recurrente ===================== */
function FacturacionTab() {
  const ahora = new Date();
  const periodoActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
  const [periodo, setPeriodo] = useState(periodoActual);
  const [preview, setPreview] = useState<BillingPreviewT | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function cargarPreview() {
    setErr(null); setResult(null); setPreview(null);
    try { setPreview(await billingPreview(periodo)); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { cargarPreview(); /* eslint-disable-next-line */ }, [periodo]);

  async function ejecutar() {
    if (!confirm(`¿Generar las facturas del periodo ${periodo}? Esto crea facturas reales y las contabiliza.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await billingRun(periodo, false);
      setResult(`✓ ${r.generadas} factura(s) generadas, ${r.contabilizadas} contabilizadas, total ${money(r.totalFacturado)}. Errores: ${r.errores.length}`);
      cargarPreview();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function suspender() {
    if (!confirm("¿Suspender a los clientes morosos (pasada la gracia)? Cambia su servicio a 'suspendido'.")) return;
    setBusy(true); setErr(null);
    try {
      const r = await suspenderMorosos(true);
      setResult(`Suspensión aplicada: ${r.serviciosASuspender} servicio(s) suspendido(s), ${r.marcadasVencidas} factura(s) marcadas vencidas.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="glass p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Periodo a facturar">
            <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={input} />
          </Field>
          <button onClick={ejecutar} disabled={busy || !preview?.facturasAGenerar} className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">
            {busy ? "Procesando…" : `Generar ${preview?.facturasAGenerar ?? 0} factura(s)`}
          </button>
          <button onClick={suspender} disabled={busy} className="rounded-lg border border-status-sin/40 px-4 py-2 text-sm font-semibold text-status-sin hover:bg-status-sin/10">
            Suspender morosos
          </button>
        </div>
        {err && <div className="mt-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}
        {result && <div className="mt-3 rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-2 text-xs text-status-ftth">{result}</div>}
      </div>

      {preview && (
        <div className="glass p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide text-cica-muted">Previsualización (no factura aún)</div>
            <div className="text-sm font-bold text-cica-gold">{money(preview.totalAFacturar)}</div>
          </div>
          {preview.facturasAGenerar === 0 ? (
            <p className="text-xs text-cica-muted">No hay servicios pendientes de facturar en {periodo} (ya facturados o sin tarifa).</p>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-cica-muted"><th className="text-left">Cliente</th><th className="text-left">Plan</th><th className="text-right">Días</th><th className="text-right px-2">Total</th></tr></thead>
              <tbody>
                {preview.items.map((it, i) => (
                  <tr key={i} className="border-t border-cica-border/30">
                    <td className="py-1 text-cica-silver">{it.cliente}</td>
                    <td className="text-cica-muted">{it.plan}{it.prorrateo ? " (prorrateo)" : ""}</td>
                    <td className="text-right text-cica-muted">{it.dias}</td>
                    <td className="text-right px-2 text-cica-silver">{money(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
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
  const [tipo, setTipo] = useState("");

  async function refresh() {
    setLoading(true);
    try { setAsientos(await listAsientos(tipo ? { tipo } : {})); setErr(null); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tipo]);

  async function reversar(a: AsientoContable) {
    if (!confirm(`¿Reversar el comprobante ${a.numero}? Se creará un asiento inverso (no se borra el original).`)) return;
    try { await reversarAsiento(a.id); await refresh(); } catch (e: any) { alert(e.message); }
  }

  if (loading) return <Cargando />;
  if (err) return <Aviso texto={err} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-cica-muted">Tipo:</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${input} max-w-[200px]`}>
          <option value="">Todos</option>
          <option value="venta">Venta (FV)</option>
          <option value="recaudo">Recaudo (RC)</option>
          <option value="compra">Compra (CC)</option>
          <option value="gasto">Egreso (CE)</option>
          <option value="manual">Nota contable (NC)</option>
          <option value="ajuste">Ajuste (NC)</option>
          <option value="reversion">Reversión (RV)</option>
        </select>
      </div>
      {asientos.length === 0 && <Aviso texto="No hay comprobantes con este filtro." />}
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
  const [rep, setRep] = useState<"balance" | "resultados" | "general" | "niif">("balance");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    const fn = rep === "balance" ? balanceComprobacion() : rep === "resultados" ? estadoResultados() : rep === "general" ? balanceGeneral() : situacionNiif();
    fn.then(setData).catch((e) => setErr(e.message));
  }, [rep]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {([["balance", "Balance de comprobación"], ["resultados", "Estado de resultados"], ["general", "Balance general"], ["niif", "Situación financiera (NIIF)"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setRep(k)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${rep === k ? "bg-cica-gold/20 text-cica-gold" : "bg-cica-border/30 text-cica-muted hover:text-cica-silver"}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => downloadFile("/accounting/reportes/balance.csv", "balance-comprobacion.csv").catch((e) => alert(e.message))} className="rounded-lg border border-cica-border px-3 py-1.5 text-xs text-cica-silver hover:border-cica-gold/40">Exportar balance (Excel)</button>
          <button onClick={() => downloadFile("/accounting/reportes/libro-diario.csv", "libro-diario.csv").catch((e) => alert(e.message))} className="rounded-lg border border-cica-border px-3 py-1.5 text-xs text-cica-silver hover:border-cica-gold/40">Libro diario (Excel)</button>
          <button onClick={() => window.print()} className="rounded-lg border border-cica-border px-3 py-1.5 text-xs text-cica-silver hover:border-cica-gold/40">Imprimir / PDF</button>
        </div>
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
      {data && rep === "niif" && (
        <div className="glass p-4 text-sm">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-cica-muted">Estado de Situación Financiera (NIIF) · {data.hasta}</div>
          <Row label="Activo corriente" value={money(data.totales.activoCorriente)} />
          <Row label="Activo no corriente" value={money(data.totales.activoNoCorriente)} />
          <Row label="= TOTAL ACTIVO" value={money(data.totales.totalActivo)} bold accent="text-cica-gold" />
          <div className="h-2" />
          <Row label="Pasivo corriente" value={money(data.totales.pasivoCorriente)} />
          <Row label="Pasivo no corriente" value={money(data.totales.pasivoNoCorriente)} />
          <Row label="= TOTAL PASIVO" value={money(data.totales.totalPasivo)} bold />
          <div className="h-2" />
          <Row label="Patrimonio (incl. resultado)" value={money(data.totales.totalPatrimonio)} />
          <Row label="= PASIVO + PATRIMONIO" value={money(data.totales.pasivoMasPatrimonio)} bold accent={data.cuadra ? "text-status-ftth" : "text-status-sin"} />
          <div className={`mt-2 text-xs font-semibold ${data.cuadra ? "text-status-ftth" : "text-status-sin"}`}>{data.cuadra ? "✓ Cuadra (Activo = Pasivo + Patrimonio)" : "⚠ No cuadra"}</div>
          <p className="mt-2 text-[10px] text-cica-muted">Clasificación corriente/no corriente derivada del PUC (aproximación NIIF para revisión de la contadora).</p>
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
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-white">{title}</h3>
          <button onClick={onClose} className="text-cica-muted hover:text-white">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
