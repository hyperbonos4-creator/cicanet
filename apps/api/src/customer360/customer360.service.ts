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

  async get(codigo: string) {
    const servicio = await this.prisma.servicio.findFirst({
      where: { cliente: { codigo } },
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

    // --- Tickets (del cliente: por clienteId o por documento de login) ---
    const tickets = await this.prisma.ticket.findMany({
      where: { OR: [{ clienteId: c.id }, { creadoPor: c.documento }] },
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });
    const ticketsAbiertos = tickets.filter((t) => t.estado === 'abierto' || t.estado === 'en_proceso').length;

    // --- Red / topología ---
    const red = this.resolverRed(servicio.napId, {
      onuSerial: servicio.onuSerial,
      puerto: servicio.puerto,
      ip: servicio.ip,
      vlan: servicio.vlan,
    }, c.nombre);

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
      },
      cadena,
    };
  }
}

function formatCOP(n: number): string {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
