"use client";

import { useEffect, useState } from "react";
import { getCliente, type Cliente } from "../../lib/api";
import { money } from "./ClientesModule";

const SERVICIO_LABEL: Record<string, string> = {
  instalacion_pendiente: "Instalación pendiente",
  activo: "Activo",
  suspendido: "Suspendido",
  cortado: "Cortado",
};
const ESTADO_TONE: Record<string, string> = {
  activo: "text-status-ftth bg-status-ftth/10 border-status-ftth/30",
  suspendido: "text-status-parcial bg-status-parcial/10 border-status-parcial/30",
  moroso: "text-status-parcial bg-status-parcial/10 border-status-parcial/30",
  retirado: "text-cica-muted bg-cica-border/30 border-cica-border/60",
};

export default function ClienteDetail({
  id, canEdit, napOptions, onBack, onEdit, onDelete, onQuickEstado,
}: {
  id: string;
  canEdit: boolean;
  napOptions: { id: string; nombre: string }[];
  onBack: () => void;
  onEdit: (c: Cliente) => void;
  onDelete: (id: string) => void;
  onQuickEstado: (c: Cliente, estado: Cliente["estado"], estadoServicio: Cliente["estadoServicio"]) => Promise<void>;
}) {
  const [c, setC] = useState<Cliente | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    let alive = true;
    getCliente(id).then((r) => alive && setC(r)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id]);

  if (err) return <div className="mx-auto max-w-3xl text-sm text-status-sin">{err}</div>;
  if (!c) return <div className="mx-auto max-w-3xl py-10 text-center text-cica-muted">Cargando ficha…</div>;

  const napNombre = c.napId ? napOptions.find((n) => n.id === c.napId)?.nombre || c.napId : "—";
  const suspendido = c.estado === "suspendido" || c.estadoServicio === "suspendido" || c.estadoServicio === "cortado";

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="text-[11px] text-cica-muted hover:text-cica-gold">← Suscriptores</button>

      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-extrabold text-white">{c.nombre}</h2>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${ESTADO_TONE[c.estado] || ESTADO_TONE.retirado}`}>{c.estado}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-cica-muted">{c.id} · {c.tipoDocumento} {c.documento} · {c.tipoCliente}</div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {suspendido ? (
              <button onClick={() => onQuickEstado(c, "activo", "activo")} className="rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-1.5 text-xs font-semibold text-status-ftth">Reactivar</button>
            ) : (
              <button onClick={() => onQuickEstado(c, "suspendido", "suspendido")} className="rounded-lg border border-status-parcial/40 bg-status-parcial/10 px-3 py-1.5 text-xs font-semibold text-status-parcial">Suspender</button>
            )}
            <button onClick={() => onEdit(c)} className="btn-cica text-xs">Editar</button>
            {confirmDel ? (
              <button onClick={() => onDelete(c.id)} className="rounded-lg border border-status-sin/50 bg-status-sin/15 px-3 py-1.5 text-xs font-semibold text-status-sin">Confirmar eliminar</button>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="rounded-lg border border-cica-border px-3 py-1.5 text-xs text-cica-muted hover:text-status-sin">Eliminar</button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Identificación y contacto">
          <Row k="Documento" v={`${c.tipoDocumento} ${c.documento}`} />
          <Row k="Tipo" v={c.tipoCliente} />
          <Row k="Correo" v={c.email} />
          <Row k="Móvil" v={c.telefonoMovil} />
          <Row k="Fijo" v={c.telefonoFijo} />
        </Block>

        <Block title="Dirección de instalación">
          <Row k="Dirección" v={c.direccion} />
          <Row k="Barrio" v={c.barrio} />
          <Row k="Comuna" v={c.comuna} />
          <Row k="Ciudad" v={[c.ciudad, c.departamento].filter(Boolean).join(", ")} />
          <Row k="Estrato" v={c.estrato != null ? String(c.estrato) : undefined} />
          <Row k="Referencias" v={c.referencias} />
        </Block>

        <Block title="Plan y datos técnicos">
          <Row k="Plan" v={c.plan} />
          <Row k="Velocidad" v={c.velocidadBajada ? `${c.velocidadBajada}↓ / ${c.velocidadSubida ?? "?"}↑ Mbps` : undefined} />
          <Row k="Tecnología" v={c.tecnologia} />
          <Row k="NAP / CTO" v={napNombre} />
          <Row k="Puerto" v={c.puerto != null ? String(c.puerto) : undefined} />
          <Row k="ONU" v={c.onuSerial} />
          <Row k="IP / VLAN" v={[c.ip, c.vlan != null ? `VLAN ${c.vlan}` : null].filter(Boolean).join(" · ") || undefined} />
          <Row k="Instalación" v={c.fechaInstalacion} />
          <Row k="Servicio" v={SERVICIO_LABEL[c.estadoServicio] || c.estadoServicio} />
        </Block>

        <Block title="Facturación y contrato">
          <Row k="Ciclo" v={c.cicloFacturacion} />
          <Row k="Día de corte" v={c.diaCorte != null ? String(c.diaCorte) : undefined} />
          <Row k="Método de pago" v={c.metodoPago} />
          <Row k="Tarifa" v={c.tarifa != null ? money(c.tarifa) : undefined} />
          <Row k="Saldo" v={c.saldo != null ? money(c.saldo) : undefined} />
          <Row k="Contrato" v={c.numeroContrato} />
          <Row k="Vigencia" v={[c.fechaInicioContrato, c.fechaFinContrato].filter(Boolean).join(" → ") || undefined} />
        </Block>
      </div>

      {c.notas && (
        <div className="glass mt-4 p-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-cica-muted">Notas</div>
          <p className="text-xs text-cica-silver">{c.notas}</p>
        </div>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass p-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-cica-gold">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-cica-border/30 py-1.5 text-[11px] last:border-0">
      <span className="text-cica-muted">{k}</span>
      <span className="text-right font-medium text-cica-silver">{v || "—"}</span>
    </div>
  );
}
