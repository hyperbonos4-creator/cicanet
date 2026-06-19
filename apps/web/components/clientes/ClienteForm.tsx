"use client";

import { useState } from "react";
import type { Cliente, ClienteInput } from "../../lib/api";
import { inputCls } from "./ClientesModule";

const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

export default function ClienteForm({
  initial,
  napOptions,
  onCancel,
  onSave,
}: {
  initial: Cliente | null;
  napOptions: { id: string; nombre: string }[];
  onCancel: () => void;
  onSave: (input: ClienteInput, id?: string) => Promise<void>;
}) {
  const [f, setF] = useState<ClienteInput>(() => ({
    tipoDocumento: initial?.tipoDocumento ?? "CC",
    documento: initial?.documento ?? "",
    nombre: initial?.nombre ?? "",
    tipoCliente: initial?.tipoCliente ?? "residencial",
    email: initial?.email ?? "",
    telefonoMovil: initial?.telefonoMovil ?? "",
    telefonoFijo: initial?.telefonoFijo ?? "",
    direccion: initial?.direccion ?? "",
    barrio: initial?.barrio ?? "",
    comuna: initial?.comuna ?? "",
    ciudad: initial?.ciudad ?? "Medellín",
    departamento: initial?.departamento ?? "Antioquia",
    estrato: initial?.estrato,
    referencias: initial?.referencias ?? "",
    plan: initial?.plan ?? "",
    velocidadBajada: initial?.velocidadBajada,
    velocidadSubida: initial?.velocidadSubida,
    tecnologia: initial?.tecnologia ?? "FTTH",
    napId: initial?.napId ?? "",
    puerto: initial?.puerto,
    onuSerial: initial?.onuSerial ?? "",
    ip: initial?.ip ?? "",
    vlan: initial?.vlan,
    fechaInstalacion: initial?.fechaInstalacion ?? "",
    estadoServicio: initial?.estadoServicio ?? "instalacion_pendiente",
    cicloFacturacion: initial?.cicloFacturacion ?? "mensual",
    diaCorte: initial?.diaCorte,
    metodoPago: initial?.metodoPago ?? "efectivo",
    tarifa: initial?.tarifa,
    saldo: initial?.saldo,
    numeroContrato: initial?.numeroContrato ?? "",
    fechaInicioContrato: initial?.fechaInicioContrato ?? "",
    fechaFinContrato: initial?.fechaFinContrato ?? "",
    estado: initial?.estado ?? "activo",
    notas: initial?.notas ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof ClienteInput) => (v: any) => setF((s) => ({ ...s, [k]: v }));

  const missing: string[] = [];
  if (!f.documento?.trim()) missing.push("documento");
  if (!f.nombre?.trim()) missing.push("nombre");
  if (!f.direccion?.trim()) missing.push("dirección");
  if (!f.ciudad?.trim()) missing.push("ciudad");
  if (!f.plan?.trim()) missing.push("plan");

  async function submit() {
    if (missing.length) { setErr(`Faltan campos obligatorios: ${missing.join(", ")}.`); return; }
    setBusy(true); setErr(null);
    try {
      // Limpia strings vacíos a undefined para no persistir basura.
      const payload: ClienteInput = Object.fromEntries(
        Object.entries(f).map(([k, v]) => [k, v === "" ? undefined : v]),
      );
      await onSave(payload, initial?.id);
    } catch (e: any) { setErr(e.message || "No se pudo guardar"); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <button onClick={onCancel} className="text-[11px] text-cica-muted hover:text-cica-gold">← Volver</button>
          <h2 className="mt-1 text-lg font-extrabold text-white">{initial ? `Editar ${initial.nombre}` : "Nuevo suscriptor"}</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded-lg border border-cica-border bg-cica-navy/60 px-4 py-2 text-xs text-cica-muted hover:text-cica-silver">Cancelar</button>
          <button onClick={submit} disabled={busy} className="btn-cica text-xs disabled:opacity-50">{busy ? "Guardando…" : initial ? "Guardar cambios" : "Crear cliente"}</button>
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}

      <div className="flex flex-col gap-4">
        {/* 1. Identificación y contacto */}
        <Section n={1} title="Identificación y contacto">
          <Field label="Tipo de documento">
            <Select value={f.tipoDocumento} onChange={set("tipoDocumento")} options={[["CC", "Cédula (CC)"], ["CE", "Cédula extranjería (CE)"], ["NIT", "NIT"], ["PAS", "Pasaporte"]]} />
          </Field>
          <Field label="Número de documento" req>
            <input className={inputCls} value={f.documento || ""} onChange={(e) => set("documento")(e.target.value)} />
          </Field>
          <Field label="Nombre / Razón social" req wide>
            <input className={inputCls} value={f.nombre || ""} onChange={(e) => set("nombre")(e.target.value)} />
          </Field>
          <Field label="Tipo de cliente">
            <Select value={f.tipoCliente} onChange={set("tipoCliente")} options={[["residencial", "Residencial"], ["empresarial", "Empresarial"]]} />
          </Field>
          <Field label="Correo electrónico">
            <input type="email" className={inputCls} value={f.email || ""} onChange={(e) => set("email")(e.target.value)} />
          </Field>
          <Field label="Teléfono móvil">
            <input className={inputCls} value={f.telefonoMovil || ""} onChange={(e) => set("telefonoMovil")(e.target.value)} />
          </Field>
          <Field label="Teléfono fijo">
            <input className={inputCls} value={f.telefonoFijo || ""} onChange={(e) => set("telefonoFijo")(e.target.value)} />
          </Field>
        </Section>

        {/* 2. Dirección de instalación */}
        <Section n={2} title="Dirección de instalación">
          <Field label="Dirección" req wide>
            <input className={inputCls} value={f.direccion || ""} onChange={(e) => set("direccion")(e.target.value)} placeholder="Calle 77DD #71-30" />
          </Field>
          <Field label="Barrio"><input className={inputCls} value={f.barrio || ""} onChange={(e) => set("barrio")(e.target.value)} /></Field>
          <Field label="Comuna"><input className={inputCls} value={f.comuna || ""} onChange={(e) => set("comuna")(e.target.value)} /></Field>
          <Field label="Ciudad" req><input className={inputCls} value={f.ciudad || ""} onChange={(e) => set("ciudad")(e.target.value)} /></Field>
          <Field label="Departamento"><input className={inputCls} value={f.departamento || ""} onChange={(e) => set("departamento")(e.target.value)} /></Field>
          <Field label="Estrato">
            <Select value={String(f.estrato ?? "")} onChange={(v) => set("estrato")(num(v))} options={[["", "—"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]]} />
          </Field>
          <Field label="Referencias" wide><input className={inputCls} value={f.referencias || ""} onChange={(e) => set("referencias")(e.target.value)} placeholder="Casa esquinera, portón verde…" /></Field>
        </Section>

        {/* 3. Plan y datos técnicos */}
        <Section n={3} title="Plan y datos técnicos">
          <Field label="Plan" req><input className={inputCls} value={f.plan || ""} onChange={(e) => set("plan")(e.target.value)} placeholder="Hogar 300 Megas" /></Field>
          <Field label="Bajada (Mbps)"><input type="number" className={inputCls} value={f.velocidadBajada ?? ""} onChange={(e) => set("velocidadBajada")(num(e.target.value))} /></Field>
          <Field label="Subida (Mbps)"><input type="number" className={inputCls} value={f.velocidadSubida ?? ""} onChange={(e) => set("velocidadSubida")(num(e.target.value))} /></Field>
          <Field label="Tecnología">
            <Select value={f.tecnologia} onChange={set("tecnologia")} options={[["FTTH", "FTTH (fibra)"], ["Inalambrico", "Inalámbrico"], ["HFC", "HFC (coaxial)"]]} />
          </Field>
          <Field label="NAP / CTO asignada">
            <Select value={f.napId || ""} onChange={set("napId")} options={[["", "— sin asignar"], ...napOptions.map((n) => [n.id, n.nombre] as [string, string])]} />
          </Field>
          <Field label="Puerto"><input type="number" className={inputCls} value={f.puerto ?? ""} onChange={(e) => set("puerto")(num(e.target.value))} /></Field>
          <Field label="Serial ONU"><input className={inputCls} value={f.onuSerial || ""} onChange={(e) => set("onuSerial")(e.target.value)} /></Field>
          <Field label="IP"><input className={inputCls} value={f.ip || ""} onChange={(e) => set("ip")(e.target.value)} placeholder="10.20.0.0" /></Field>
          <Field label="VLAN"><input type="number" className={inputCls} value={f.vlan ?? ""} onChange={(e) => set("vlan")(num(e.target.value))} /></Field>
          <Field label="Fecha de instalación"><input type="date" className={inputCls} value={f.fechaInstalacion || ""} onChange={(e) => set("fechaInstalacion")(e.target.value)} /></Field>
          <Field label="Estado del servicio">
            <Select value={f.estadoServicio} onChange={set("estadoServicio")} options={[["instalacion_pendiente", "Instalación pendiente"], ["activo", "Activo"], ["suspendido", "Suspendido"], ["cortado", "Cortado"]]} />
          </Field>
        </Section>

        {/* 4. Facturación y contrato */}
        <Section n={4} title="Facturación y contrato">
          <Field label="Ciclo de facturación">
            <Select value={f.cicloFacturacion} onChange={set("cicloFacturacion")} options={[["mensual", "Mensual"], ["bimestral", "Bimestral"], ["anticipado", "Anticipado"]]} />
          </Field>
          <Field label="Día de corte"><input type="number" min={1} max={31} className={inputCls} value={f.diaCorte ?? ""} onChange={(e) => set("diaCorte")(num(e.target.value))} /></Field>
          <Field label="Método de pago">
            <Select value={f.metodoPago} onChange={set("metodoPago")} options={[["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["PSE", "PSE"]]} />
          </Field>
          <Field label="Tarifa mensual (COP)"><input type="number" className={inputCls} value={f.tarifa ?? ""} onChange={(e) => set("tarifa")(num(e.target.value))} /></Field>
          <Field label="Saldo pendiente (COP)"><input type="number" className={inputCls} value={f.saldo ?? ""} onChange={(e) => set("saldo")(num(e.target.value))} /></Field>
          <Field label="N.º de contrato"><input className={inputCls} value={f.numeroContrato || ""} onChange={(e) => set("numeroContrato")(e.target.value)} /></Field>
          <Field label="Inicio de contrato"><input type="date" className={inputCls} value={f.fechaInicioContrato || ""} onChange={(e) => set("fechaInicioContrato")(e.target.value)} /></Field>
          <Field label="Fin de contrato"><input type="date" className={inputCls} value={f.fechaFinContrato || ""} onChange={(e) => set("fechaFinContrato")(e.target.value)} /></Field>
          <Field label="Estado del cliente">
            <Select value={f.estado} onChange={set("estado")} options={[["activo", "Activo"], ["suspendido", "Suspendido"], ["moroso", "Moroso"], ["retirado", "Retirado"]]} />
          </Field>
          <Field label="Notas" wide><input className={inputCls} value={f.notas || ""} onChange={(e) => set("notas")(e.target.value)} /></Field>
        </Section>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-cica-border bg-cica-navy/60 px-4 py-2 text-xs text-cica-muted hover:text-cica-silver">Cancelar</button>
        <button onClick={submit} disabled={busy} className="btn-cica text-xs disabled:opacity-50">{busy ? "Guardando…" : initial ? "Guardar cambios" : "Crear cliente"}</button>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="glass p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-[11px] font-bold text-cica-black">{n}</span>
        <h3 className="text-sm font-bold text-cica-silver">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function Field({ label, req, wide, children }: { label: string; req?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-cica-muted">{label}{req && <span className="text-cica-gold"> *</span>}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }: { value: any; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
