import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InfraService } from '../infra/infra.service';

const num = (d: Prisma.Decimal | null) => (d != null ? Number(d) : 0);
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface Alerta {
  tipo: string;
  nivel: 'alta' | 'media' | 'info';
  mensaje: string;
}

export interface TimelineEvent {
  fecha: string;
  tipo: 'cliente' | 'servicio' | 'instalacion' | 'factura' | 'pago' | 'ticket' | 'orden';
  titulo: string;
  detalle?: string;
}

/**
 * Customer 360: agrega TODO lo del suscriptor en una sola respuesta —
 * identidad, servicio (comercial+técnico), facturación, tickets, y la RUTA de
 * red real (ONU → NAP → ... → OLT/POP) derivada del inventario de infra +
 * la topología por `padreId`. Más alertas operativas (mora, NAP saturada).
 */
@Injectable()
export class Customer360Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly infra: InfraService,
  ) {}

  async get(idOrCodigo: string) {
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCodigo);
    const servicio = await this.prisma.servicio.findFirst({
      where: { cliente: esUuid ? { id: idOrCodigo } : { codigo: idOrCodigo } },
      include: { cliente: true, punto: true },
      orderBy: { creadoEn: 'asc' },
    });
    if (!servicio) throw new NotFoundException('Cliente no encontrado.');
    const c = servicio.cliente;
    const p = servicio.punto;

    // --- Facturación ---
    const facturas = await this.prisma.factura.findMany({
      where: { servicioId: servicio.id },
      orderBy: { fechaEmision: 'desc' },
      take: 24,
    });
    const pago = await this.prisma.pago.findFirst({
      where: { factura: { servicioId: servicio.id }, estado: 'aprobado' },
      orderBy: { pagadoEn: 'desc' },
    });
    const hoy = new Date();
    const vencidas = facturas.filter(
      (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.fechaVencimiento < hoy,
    );
    const pendientes = facturas.filter((f) => f.estado !== 'pagada' && f.estado !== 'anulada');

    // --- Tickets (del cliente: por clienteId UUID o documento de login) ---
    const tickets = await this.prisma.ticket.findMany({
      where: { OR: [{ clienteId: c.id }, { creadoPor: c.documento }] },
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });
    const ticketsAbiertos = tickets.filter((t) => t.estado === 'abierto' || t.estado === 'en_proceso').length;

    // --- Red / topología ---
    const red = this.resolverRed(servicio.activoNapId || servicio.napId, {
      onuSerial: servicio.onuSerial,
      puerto: servicio.puerto,
      ip: servicio.ip,
      vlan: servicio.vlan,
    }, c.nombre);

    // --- Vecinos: otros clientes reales colgados de la misma NAP ---
    let vecinos: { total: number; conFalla: number; conTicketAbierto: number } | null = null;
    if (red.encontrado && red.nap) {
      const refs = [red.nap.id, red.nap.nombre].filter(Boolean);
      const vecinosServicios = await this.prisma.servicio.findMany({
        where: { napId: { in: refs }, NOT: { id: servicio.id } },
        include: { cliente: true },
      });
      const conFalla = vecinosServicios.filter((s) => s.estado === 'suspendido' || s.estado === 'cortado').length;
      const vecinoClienteIds = vecinosServicios.map((s) => s.clienteId);
      const ticketsVecinos = vecinoClienteIds.length
        ? await this.prisma.ticket.count({
            where: { clienteId: { in: vecinoClienteIds }, estado: { in: ['abierto', 'en_proceso'] } },
          })
        : 0;
      vecinos = { total: vecinosServicios.length, conFalla, conTicketAbierto: ticketsVecinos };
      (red as any).vecinos = vecinos;
    }

    // --- Alertas operativas ---
    const alertas: Alerta[] = [];
    const saldo = num(servicio.saldo);
    if (servicio.estado === 'suspendido' || servicio.estado === 'cortado') {
      alertas.push({ tipo: 'servicio', nivel: 'alta', mensaje: `Servicio ${servicio.estado}.` });
    }
    if (vencidas.length) {
      const dias = Math.floor((hoy.getTime() - vencidas[vencidas.length - 1].fechaVencimiento.getTime()) / 86400000);
      alertas.push({ tipo: 'mora', nivel: 'alta', mensaje: `${vencidas.length} factura(s) vencida(s)${dias > 0 ? ` (mora ${dias} días)` : ''}.` });
    } else if (saldo > 0) {
      alertas.push({ tipo: 'saldo', nivel: 'media', mensaje: `Saldo pendiente de ${formatCOP(saldo)}.` });
    }
    if (red.nap?.capacidad) {
      const s = red.nap.capacidad.semaforo;
      if (s === 'rojo') alertas.push({ tipo: 'capacidad', nivel: 'alta', mensaje: `La NAP ${red.nap.nombre} está saturada (${red.nap.capacidad.usados}/${red.nap.capacidad.total}).` });
      else if (s === 'amarillo') alertas.push({ tipo: 'capacidad', nivel: 'media', mensaje: `La NAP ${red.nap.nombre} tiene poca capacidad libre.` });
    }
    if (!red.encontrado && servicio.estado === 'activo') {
      alertas.push({ tipo: 'red', nivel: 'info', mensaje: 'El servicio no tiene una NAP de red asignada en el inventario.' });
    }
    if (ticketsAbiertos > 0) {
      alertas.push({ tipo: 'soporte', nivel: 'info', mensaje: `${ticketsAbiertos} ticket(s) de soporte abierto(s).` });
    }
    if (vecinos && vecinos.conTicketAbierto >= 2) {
      alertas.push({ tipo: 'red', nivel: 'alta', mensaje: `${vecinos.conTicketAbierto} clientes de la misma NAP tienen tickets abiertos — posible falla compartida.` });
    }

    return {
      cliente: {
        id: c.codigo,
        nombre: c.nombre,
        tipoDocumento: c.tipoDocumento,
        documento: c.documento,
        tipoCliente: c.tipoCliente,
        email: c.email,
        telefonoMovil: c.telefonoMovil,
        telefonoFijo: c.telefonoFijo,
        estado: c.estado,
        creadoEn: c.creadoEn.toISOString(),
      },
      ubicacion: {
        direccion: p.direccion,
        barrio: p.barrio,
        comuna: p.comuna,
        ciudad: p.ciudad,
        estrato: p.estrato,
        lat: p.lat,
        lng: p.lng,
        referencias: p.referencias,
      },
      servicio: {
        plan: servicio.planNombre,
        estadoServicio: servicio.estado,
        estadoCliente: c.estado,
        tecnologia: servicio.tecnologia,
        velocidadBajada: servicio.velocidadBajada,
        velocidadSubida: servicio.velocidadSubida,
        tarifa: num(servicio.tarifa),
        saldo,
        diaCorte: servicio.diaCorte,
        cicloFacturacion: servicio.cicloFacturacion,
        metodoPago: servicio.metodoPago,
        numeroContrato: servicio.numeroContrato,
        fechaInstalacion: dateOnly(servicio.fechaInstalacion),
        ip: servicio.ip,
        vlan: servicio.vlan,
        onuSerial: servicio.onuSerial,
        puerto: servicio.puerto,
        napId: servicio.napId,
      },
      facturacion: {
        saldo,
        vencidas: vencidas.length,
        pendientes: pendientes.length,
        ultimoPago: pago ? { monto: num(pago.monto), fecha: pago.pagadoEn?.toISOString() ?? null, metodo: pago.metodo } : null,
        proximoVencimiento: pendientes.length ? dateOnly(pendientes[pendientes.length - 1].fechaVencimiento) : null,
        facturas: facturas.map((f) => ({
          id: f.id,
          periodo: f.periodo,
          total: num(f.total),
          estado: f.estado,
          fechaEmision: dateOnly(f.fechaEmision),
          fechaVencimiento: dateOnly(f.fechaVencimiento),
          pagada: f.estado === 'pagada',
        })),
      },
      tickets: tickets.map((t) => ({
        id: t.id,
        codigo: t.codigo,
        asunto: t.asunto,
        categoria: t.categoria,
        estado: t.estado,
        creadoEn: t.creadoEn.toISOString(),
      })),
      ticketsAbiertos,
      red,
      alertas,
    };
  }

  /**
   * Línea de tiempo unificada del suscriptor: fusiona en un solo flujo
   * cronológico los eventos de cliente, servicio, facturación, pagos, tickets y
   * órdenes de trabajo. Es un read-model (solo agrega; no muta nada).
   */
  async timeline(codigo: string): Promise<TimelineEvent[]> {
    const cliente = await this.prisma.cliente.findUnique({
      where: { codigo },
      include: { servicios: { include: { facturas: { include: { pagos: true } } } } },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado.');

    const ev: TimelineEvent[] = [];
    const push = (
      fecha: Date | null,
      tipo: TimelineEvent['tipo'],
      titulo: string,
      detalle?: string,
    ) => {
      if (fecha) ev.push({ fecha: fecha.toISOString(), tipo, titulo, detalle });
    };

    push(cliente.creadoEn, 'cliente', 'Cliente creado', cliente.codigo);

    for (const s of cliente.servicios) {
      push(s.creadoEn, 'servicio', 'Servicio registrado', s.planNombre);
      if (s.fechaInstalacion) {
        const napTxt = s.napId ? ` · NAP ${s.napId}` : '';
        push(s.fechaInstalacion, 'instalacion', 'Instalación realizada', `${s.tecnologia}${napTxt}`);
      }
      for (const f of s.facturas) {
        push(
          f.fechaEmision,
          'factura',
          `Factura ${f.periodo}`,
          `${formatCOP(Number(f.total))} · ${f.estado}`,
        );
        for (const p of f.pagos) {
          if (p.estado === 'aprobado') {
            push(p.pagadoEn ?? p.creadoEn, 'pago', 'Pago aprobado', `${formatCOP(Number(p.monto))} · ${p.metodo}`);
          }
        }
      }
    }

    const tickets = await this.prisma.ticket.findMany({
      where: { OR: [{ clienteId: cliente.id }, { creadoPor: cliente.documento }] },
    });
    for (const t of tickets) {
      push(t.creadoEn, 'ticket', `Ticket ${t.codigo}`, `${t.asunto} · ${t.estado}`);
    }

    const ordenes = await this.prisma.ordenTrabajo.findMany({
      where: { clienteId: cliente.id },
    });
    for (const o of ordenes) {
      push(o.creadoEn, 'orden', `OT ${o.codigo} (${o.tipo})`, o.titulo);
      if (o.completadaEn) push(o.completadaEn, 'orden', `OT ${o.codigo} completada`, o.titulo);
    }

    return ev.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

  /** Resuelve la NAP del servicio en el inventario y arma la ruta hasta el POP. */
  private resolverRed(
    napId: string | null,
    onu: { onuSerial: string | null; puerto: number | null; ip: string | null; vlan: number | null },
    nombreCliente: string,
  ) {
    const assets = this.infra.listAssets();
    const asset = napId
      ? assets.find((a: any) => a.id === napId || a.nombre === napId)
      : undefined;

    if (!asset) {
      return {
        encontrado: false,
        nap: null as any,
        onu,
        cadena: [] as Array<{ id: string; nombre: string; tipo: string }>,
      };
    }

    const detalle = this.infra.getAssetDetail(asset.id);
    // ancestros: padre, abuelo, ..., raíz (POP). Cadena root→cliente para la UI.
    const ancestros = (detalle.ancestros as Array<{ id: string; nombre: string; tipo: string }>) ?? [];
    const cadena = [
      ...[...ancestros].reverse(),
      { id: asset.id, nombre: asset.nombre, tipo: asset.tipo },
    ];
    if (onu.onuSerial) cadena.push({ id: onu.onuSerial, nombre: `ONU ${onu.onuSerial}`, tipo: 'ONU' });
    cadena.push({ id: 'cliente', nombre: nombreCliente, tipo: 'Cliente' });

    return {
      encontrado: true,
      onu,
      nap: {
        id: asset.id,
        nombre: asset.nombre,
        tipo: asset.tipo,
        direccion: (asset as any).direccion ?? null,
        capacidad: detalle.capacidad,
        impacto: detalle.impacto,
        fotos: (detalle as any).fotos ?? [],
      },
      cadena,
    };
  }
}

function formatCOP(n: number): string {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
