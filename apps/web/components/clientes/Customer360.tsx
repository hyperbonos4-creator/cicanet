"use client";

import { useEffect, useState } from "react";
import { getCliente360, updateCliente, createTicket, paymentsCheckout, type Cliente360 } from "../../lib/api";
import { money } from "./ClientesModule";

type Tab = "resumen" | "servicio" | "topologia" | "facturacion" | "tickets" | "equipos";

const TABS: { key: Tab; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "servicio", label: "Servicio" },
  { key: "topologia", label: "Topología" },
  { key: "facturacion", label: "Facturación" },
  { key: "tickets", label: "Tickets" },
  { key: "equipos", label: "Equipos" },
];

const NIVEL_TONE: Record<string, string> = {
  alta: "border-status-sin/40 bg-status-sin/10 text-status-sin",
  media: "border-status-parcial/40 bg-status-parcial/10 text-status-parcial",
  info: "border-cica-steel/40 bg-cica-steel/10 text-cica-steelLight",
};
const SEMAFORO: Record<string, string> = { verde: "text-status-ftth", amarillo: "text-status-parcial", rojo: "text-status-sin" };
const ESTADO_TONE: Record<string, string> = {
  activo: "text-status-ftth", suspendido: "text-status-parcial", cortado: "text-status-sin",
  moroso: "text-status-parcial", retirado: "text-cica-muted", instalacion_pendiente: "text-cica-steelLight",
};

export default function Customer360({
  id, canEdit, onBack, onEdit, onVerEnMapa,
}: {
  id: string;
  canEdit: boolean;
  onBack: () => void;
  onEdit: (id: string) => void;
  onVerEnMapa?: (lng: number, lat: number) => void;
}) {
  const [data, setData] = useState<Cliente360 | null>(null);
  const [tab, setTab] = useState<Tab>("resumen");
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [cobroUrl, setCobroUrl] = useState<string | null>(null);

  function reload() {
    getCliente360(id).then(setData).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    getCliente360(id).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  async function cobrar() {
    if (acting || !data) return;
    const pendiente = data.facturacion.facturas.find((f) => !f.pagada && f.estado !== "anulada");
    setActing(true);
    setToast(null);
    setCobroUrl(null);
    try {
      const co = pendiente
        ? await paymentsCheckout({ facturaId: pendiente.id, email: data.cliente.email ?? undefined })
        : await paymentsCheckout({ montoCents: Math.round(data.servicio.saldo * 100), descripcion: `Saldo ${data.cliente.nombre}`, email: data.cliente.email ?? undefined });
      setCobroUrl(co.checkoutUrl);
      setToast("Link de pago generado ✓");
    } catch (e: any) {
      setToast(e.message || "No se pudo generar el cobro.");
    } finally {
      setActing(false);
    }
  }

  async function accionEstado(estadoServicio: string, estadoCliente: string, label: string) {
    if (acting) return;
    setActing(true);
    setToast(null);
    try {
      await updateCliente(id, { estadoServicio: estadoServicio as any, estado: estadoCliente as any });
      setToast(`${label} ✓`);
      reload();
    } catch (e: any) {
      setToast(e.message || "No se pudo aplicar la acción.");
    } finally {
      setActing(false);
    }
  }

  if (err) return <div className="mx-auto max-w-5xl"><button onClick={onBack} className="mb-4 text-xs text-cica-gold">← Volver</button><div className="glass p-6 text-sm text-status-sin">{err}</div></div>;
  if (!data) return <div className="grid h-full place-items-center text-cica-muted"><div className="h-9 w-9 animate-spin rounded-full border-2 border-cica-border border-t-cica-gold" /></div>;

  const { cliente, servicio, ubicacion, facturacion, tickets, red, alertas } = data;
  const inicial = cliente.nombre.charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-6xl">
      <button onClick={onBack} className="mb-3 text-xs text-cica-gold hover:underline">← Suscriptores</button>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ===== Columna A: identidad ===== */}
        <aside className="flex flex-col gap-3">
          <div className="glass p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-cica-amber to-cica-gold text-lg font-bold text-cica-black">{inicial}</div>
              <div className="min-w-0">
                <div className="truncate text-base font-extrabold text-white">{cliente.nombre}</div>
                <div className="text-[11px] text-cica-muted">{cliente.id} · {cliente.tipoDocumento} {cliente.documento}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1.5 text-xs">
              <Info label="Estado" value={<span className={`font-semibold ${ESTADO_TONE[cliente.estado] || "text-cica-silver"}`}>{cliente.estado}</span>} />
              <Info label="Servicio" value={<span className={`font-semibold ${ESTADO_TONE[servicio.estadoServicio] || "text-cica-silver"}`}>{servicio.estadoServicio.replace(/_/g, " ")}</span>} />
              <Info label="Plan" value={servicio.plan} />
              <Info label="Saldo" value={<span className={servicio.saldo > 0 ? "text-status-sin font-semibold" : "text-cica-silver"}>{money(servicio.saldo)}</span>} />
              <Info label="Teléfono" value={cliente.telefonoMovil || "—"} />
              <Info label="Dirección" value={`${ubicacion.direccion}${ubicacion.barrio ? ", " + ubicacion.barrio : ""}`} />
            </div>
            {canEdit && (
              <button onClick={() => onEdit(cliente.id)} className="btn-cica mt-4 w-full text-xs">Editar datos</button>
            )}
            {onVerEnMapa && ubicacion.lat != null && ubicacion.lng != null && (
              <button
                onClick={() => onVerEnMapa(ubicacion.lng!, ubicacion.lat!)}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-cica-steel/50 px-3 py-1.5 text-xs font-semibold text-cica-steelLight transition-colors hover:bg-cica-steel/15"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>
                Ver en mapa
              </button>
            )}
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-2">
                {servicio.estadoServicio === "activo" && (
                  <ActionBtn disabled={acting} tone="warn" onClick={() => accionEstado("suspendido", "suspendido", "Suspendido")}>Suspender</ActionBtn>
                )}
                {(servicio.estadoServicio === "suspendido" || servicio.estadoServicio === "cortado") && (
                  <ActionBtn disabled={acting} tone="ok" onClick={() => accionEstado("activo", "activo", "Reactivado")}>Reactivar</ActionBtn>
                )}
                {(servicio.estadoServicio === "activo" || servicio.estadoServicio === "suspendido") && (
                  <ActionBtn disabled={acting} tone="danger" onClick={() => accionEstado("cortado", "suspendido", "Cortado")}>Cortar</ActionBtn>
                )}
                {servicio.estadoServicio === "instalacion_pendiente" && (
                  <ActionBtn disabled={acting} tone="ok" onClick={() => accionEstado("activo", "activo", "Activado")}>Activar</ActionBtn>
                )}
                <ActionBtn disabled={acting} tone="neutral" onClick={() => setTicketOpen((v) => !v)}>Crear ticket</ActionBtn>
                {data.servicio.saldo > 0 && (
                  <ActionBtn disabled={acting} tone="ok" onClick={cobrar}>Cobrar</ActionBtn>
                )}
              </div>
            )}
            {cobroUrl && (
              <div className="mt-2 rounded-lg border border-status-ftth/40 bg-status-ftth/10 p-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-status-ftth">Link de pago</div>
                <a href={cobroUrl} target="_blank" rel="noreferrer" className="block break-all text-[11px] text-status-ftth hover:underline">{cobroUrl}</a>
                <button
                  onClick={() => { navigator.clipboard?.writeText(cobroUrl); setToast("Link copiado ✓"); }}
                  className="mt-1.5 rounded border border-status-ftth/40 px-2 py-1 text-[10px] font-semibold text-status-ftth hover:bg-status-ftth/10"
                >Copiar para WhatsApp</button>
              </div>
            )}
            {toast && <div className="mt-2 rounded-lg border border-cica-border/60 bg-cica-navy/40 px-3 py-1.5 text-[11px] text-cica-silver">{toast}</div>}
            {ticketOpen && canEdit && (
              <TicketMini
                clienteId={cliente.id}
                onClose={() => setTicketOpen(false)}
                onCreated={() => { setTicketOpen(false); setToast("Ticket creado ✓"); setTab("tickets"); reload(); }}
              />
            )}
          </div>

          {/* Alertas */}
          {alertas.length > 0 && (
            <div className="glass p-4">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-cica-muted">Alertas</div>
              <div className="flex flex-col gap-2">
                {alertas.map((a, i) => (
                  <div key={i} className={`rounded-lg border px-3 py-2 text-[11px] ${NIVEL_TONE[a.nivel]}`}>{a.mensaje}</div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ===== Columna B: tabs ===== */}
        <section>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t.key ? "bg-gradient-to-r from-cica-amber/25 to-cica-gold/10 text-cica-gold" : "text-cica-muted hover:bg-cica-border/30 hover:text-cica-silver"}`}>
                {t.label}
                {t.key === "tickets" && data.ticketsAbiertos > 0 && <span className="ml-1 rounded-full bg-status-sin/80 px-1.5 text-[9px] text-white">{data.ticketsAbiertos}</span>}
              </button>
            ))}
          </div>

          {tab === "resumen" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Estado del servicio">
                <Row k="Servicio" v={<span className={ESTADO_TONE[servicio.estadoServicio]}>{servicio.estadoServicio.replace(/_/g, " ")}</span>} />
                <Row k="Plan" v={servicio.plan} />
                <Row k="Velocidad" v={servicio.velocidadBajada ? `${servicio.velocidadBajada}/${servicio.velocidadSubida ?? "—"} Mbps` : "—"} />
                <Row k="Tecnología" v={servicio.tecnologia} />
              </Card>
              <Card title="Cobro">
                <Row k="Tarifa" v={money(servicio.tarifa)} />
                <Row k="Saldo" v={<span className={servicio.saldo > 0 ? "text-status-sin" : ""}>{money(servicio.saldo)}</span>} />
                <Row k="Próximo venc." v={facturacion.proximoVencimiento || "—"} />
                <Row k="Último pago" v={facturacion.ultimoPago ? `${money(facturacion.ultimoPago.monto)} (${facturacion.ultimoPago.metodo})` : "—"} />
              </Card>
              <Card title="Ubicación">
                <Row k="Dirección" v={ubicacion.direccion} />
                <Row k="Barrio" v={ubicacion.barrio || "—"} />
                <Row k="Estrato" v={ubicacion.estrato?.toString() || "—"} />
                <Row k="Coordenadas" v={ubicacion.lat && ubicacion.lng ? `${ubicacion.lat.toFixed(5)}, ${ubicacion.lng.toFixed(5)}` : "—"} />
              </Card>
              <Card title="Red asignada">
                {red.nap ? (
                  <>
                    <Row k="NAP / CTO" v={red.nap.nombre} />
                    <Row k="Puerto" v={red.onu.puerto?.toString() || "—"} />
                    <Row k="ONU" v={red.onu.onuSerial || "—"} />
                    <Row k="Capacidad NAP" v={red.nap.capacidad ? <span className={SEMAFORO[red.nap.capacidad.semaforo]}>{red.nap.capacidad.usados}/{red.nap.capacidad.total}</span> : "—"} />
                  </>
                ) : <div className="text-xs text-cica-muted">Sin NAP asignada en el inventario.</div>}
              </Card>
            </div>
          )}

          {tab === "servicio" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Contrato">
                <Row k="Plan" v={servicio.plan} />
                <Row k="Tecnología" v={servicio.tecnologia} />
                <Row k="Ciclo" v={servicio.cicloFacturacion || "—"} />
                <Row k="Día de corte" v={servicio.diaCorte?.toString() || "—"} />
                <Row k="Método de pago" v={servicio.metodoPago || "—"} />
                <Row k="N.º contrato" v={servicio.numeroContrato || "—"} />
                <Row k="Instalación" v={servicio.fechaInstalacion || "—"} />
              </Card>
              <Card title="Estados">
                <Row k="Comercial" v={<span className={ESTADO_TONE[servicio.estadoCliente]}>{servicio.estadoCliente}</span>} />
                <Row k="Técnico" v={<span className={ESTADO_TONE[servicio.estadoServicio]}>{servicio.estadoServicio.replace(/_/g, " ")}</span>} />
                <Row k="Tarifa" v={money(servicio.tarifa)} />
                <Row k="Saldo" v={money(servicio.saldo)} />
              </Card>
            </div>
          )}

          {tab === "topologia" && (
            <Card title="Ruta de red (POP → cliente)">
              {red.encontrado ? (
                <div className="flex flex-col gap-0">
                  {red.cadena.map((n, i) => (
                    <div key={n.id + i} className="flex items-start gap-3" style={{ paddingLeft: `${i * 18}px` }}>
                      <div className="flex flex-col items-center">
                        <span className={`grid h-7 w-7 place-items-center rounded-lg text-[10px] font-bold ${nodeTone(n.tipo)}`}>{nodeIcon(n.tipo)}</span>
                        {i < red.cadena.length - 1 && <span className="my-0.5 h-5 w-px bg-cica-border" />}
                      </div>
                      <div className="pt-1">
                        <div className="text-[10px] uppercase tracking-wide text-cica-muted">{n.tipo}</div>
                        <div className="text-sm font-semibold text-cica-silver">{n.nombre}</div>
                      </div>
                    </div>
                  ))}
                  {red.nap?.capacidad && (
                    <div className="mt-3 rounded-lg border border-cica-border/60 bg-cica-navy/40 p-3 text-xs">
                      <div className="text-cica-muted">Capacidad de {red.nap.nombre}: <span className={`font-semibold ${SEMAFORO[red.nap.capacidad.semaforo]}`}>{red.nap.capacidad.usados}/{red.nap.capacidad.total} puertos ({red.nap.capacidad.libres} libres)</span></div>
                      {red.nap.impacto && <div className="mt-1 text-cica-muted">Clientes que dependen de esta NAP: <span className="text-cica-silver">{red.nap.impacto.clientesDependientes}</span></div>}
                      {red.vecinos && red.vecinos.total > 0 && (
                        <div className="mt-1 text-cica-muted">
                          Vecinos en esta NAP: <span className="text-cica-silver">{red.vecinos.total}</span>
                          {red.vecinos.conFalla > 0 && <span className="text-status-sin"> · {red.vecinos.conFalla} con falla</span>}
                          {red.vecinos.conTicketAbierto > 0 && <span className="text-status-parcial"> · {red.vecinos.conTicketAbierto} con ticket abierto</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-cica-muted">Este servicio aún no tiene una NAP de red asignada en el inventario. Asigna una NAP desde la edición del cliente o el módulo Infraestructura.</div>
              )}
            </Card>
          )}

          {tab === "facturacion" && (
            <Card title="Facturas">
              {facturacion.facturas.length === 0 ? (
                <div className="text-xs text-cica-muted">Sin facturas registradas.</div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-wide text-cica-muted"><th className="py-1.5">Periodo</th><th>Vence</th><th>Estado</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {facturacion.facturas.map((f) => (
                      <tr key={f.id} className="border-t border-cica-border/30">
                        <td className="py-2 text-cica-silver">{f.periodo}</td>
                        <td className="text-cica-muted">{f.fechaVencimiento || "—"}</td>
                        <td><span className={f.pagada ? "text-status-ftth" : f.estado === "vencida" ? "text-status-sin" : "text-status-parcial"}>{f.estado}</span></td>
                        <td className="text-right font-semibold text-cica-silver">{money(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "tickets" && (
            <Card title="Tickets de soporte">
              {tickets.length === 0 ? (
                <div className="text-xs text-cica-muted">Este cliente no tiene tickets.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {tickets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg border border-cica-border/40 px-3 py-2">
                      <div>
                        <div className="text-xs font-semibold text-cica-silver">{t.asunto}</div>
                        <div className="text-[10px] text-cica-muted">{t.codigo} · {t.categoria} · {new Date(t.creadoEn).toLocaleDateString("es-CO")}</div>
                      </div>
                      <span className={`text-[10px] font-semibold ${t.estado === "abierto" ? "text-status-sin" : t.estado === "resuelto" || t.estado === "cerrado" ? "text-status-ftth" : "text-status-parcial"}`}>{t.estado.replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {tab === "equipos" && (
            <Card title="Equipos e instalación">
              <Row k="ONU / ONT" v={servicio.onuSerial || "—"} />
              <Row k="Puerto NAP" v={servicio.puerto?.toString() || "—"} />
              <Row k="IP" v={servicio.ip || "—"} />
              <Row k="VLAN" v={servicio.vlan?.toString() || "—"} />
              <Row k="NAP asignada" v={red.nap?.nombre || servicio.napId || "—"} />
              <div className="mt-2 text-[10px] text-cica-muted">El monitoreo de señal óptica (RX/TX) requiere integración SNMP/OLT — próximamente.</div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function nodeTone(tipo: string): string {
  switch (tipo) {
    case "POP": return "bg-cica-gold/20 text-cica-gold";
    case "OLT": return "bg-cica-steel/30 text-cica-steelLight";
    case "NAP": case "CTO": return "bg-status-ftth/20 text-status-ftth";
    case "ONU": return "bg-cica-amber/20 text-cica-amber";
    case "Cliente": return "bg-cica-border/50 text-cica-silver";
    default: return "bg-cica-border/40 text-cica-muted";
  }
}
function nodeIcon(tipo: string): string {
  switch (tipo) {
    case "POP": return "◈"; case "OLT": return "▣"; case "NAP": case "CTO": return "◰";
    case "ONU": return "◍"; case "Cliente": return "☻"; default: return "•";
  }
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-cica-muted">{label}</span><span className="text-right text-cica-silver">{value}</span></div>;
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="glass p-4"><div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-cica-muted">{title}</div><div className="flex flex-col gap-1.5">{children}</div></div>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-2 text-xs"><span className="text-cica-muted">{k}</span><span className="text-right font-medium text-cica-silver">{v}</span></div>;
}

const ACTION_TONE: Record<string, string> = {
  ok: "border-status-ftth/40 text-status-ftth hover:bg-status-ftth/10",
  warn: "border-status-parcial/40 text-status-parcial hover:bg-status-parcial/10",
  danger: "border-status-sin/40 text-status-sin hover:bg-status-sin/10",
  neutral: "border-cica-border/60 text-cica-silver hover:bg-cica-border/30",
};
function ActionBtn({ children, onClick, tone, disabled }: { children: React.ReactNode; onClick: () => void; tone: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${ACTION_TONE[tone]}`}>
      {children}
    </button>
  );
}

function TicketMini({ clienteId, onClose, onCreated }: { clienteId: string; onClose: () => void; onCreated: () => void }) {
  const [asunto, setAsunto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState("tecnico");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (asunto.trim().length < 3 || descripcion.trim().length < 3) {
      setError("Completa asunto y descripción.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createTicket({ asunto, descripcion, categoria, clienteId });
      onCreated();
    } catch (e: any) {
      setError(e.message || "No se pudo crear.");
    } finally {
      setSaving(false);
    }
  }

  const inp = "w-full rounded-lg border border-cica-border bg-cica-navy/80 px-3 py-2 text-xs text-cica-silver outline-none focus:border-cica-gold";
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-cica-border/60 bg-cica-navy/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-cica-muted">Nuevo ticket</div>
      <input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Asunto" className={inp} />
      <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción" rows={2} className={inp + " resize-none"} />
      <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inp}>
        <option value="tecnico">Técnico</option>
        <option value="facturacion">Facturación</option>
        <option value="comercial">Comercial</option>
        <option value="general">General</option>
      </select>
      {error && <div className="text-[11px] text-status-sin">{error}</div>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={saving} className="btn-cica flex-1 text-xs disabled:opacity-50">{saving ? "Creando…" : "Crear"}</button>
        <button onClick={onClose} className="rounded-lg border border-cica-border/60 px-3 text-xs text-cica-muted">Cancelar</button>
      </div>
    </div>
  );
}
