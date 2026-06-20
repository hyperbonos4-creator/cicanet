import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Workbench del contador: bandeja de "pendientes del día". Consultas directas
 * (conteos/sumas) para que la pantalla inicial sea accionable, no KPIs ejecutivos.
 * Cada tarjeta enlaza a la pestaña que la resuelve.
 */
@Injectable()
export class WorkbenchService {
  constructor(private readonly prisma: PrismaService) {}

  async resumen() {
    const ahora = new Date();
    const periodo = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;

    const [
      recibos, movsSinConciliar, comprasPend, facturasVencidas,
      comprobantesBorrador, dianRechazados, empleadosActivos, liquidacionesMes,
    ] = await Promise.all([
      this.prisma.reciboCaja.findMany({ where: { estado: { in: ['sin_aplicar', 'parcial'] } }, select: { saldoPorAplicar: true, clienteId: true } }),
      this.prisma.movimientoBancario.count({ where: { estado: 'sin_conciliar' } }),
      this.prisma.facturaCompra.findMany({ where: { estado: 'pendiente' }, select: { totalAPagar: true, fechaVencimiento: true } }),
      this.prisma.factura.findMany({ where: { estado: { in: ['pendiente', 'vencida'] }, fechaVencimiento: { lt: ahora } }, select: { id: true } }),
      this.prisma.asientoContable.count({ where: { estado: 'borrador' } }),
      this.prisma.dianDocumento.count({ where: { estado: { in: ['rechazada', 'error'] } } }),
      this.prisma.empleado.count({ where: { estado: 'activo' } }),
      this.prisma.liquidacionNomina.count({ where: { periodo } }),
    ]);

    const recibosPorAplicar = recibos.length;
    const saldoPorAplicar = round2(recibos.reduce((s, r) => s + D(r.saldoPorAplicar), 0));
    const recibosHuerfanos = recibos.filter((r) => !r.clienteId).length;
    const comprasVencidas = comprasPend.filter((c) => c.fechaVencimiento.getTime() < ahora.getTime()).length;
    const comprasPorPagar = round2(comprasPend.reduce((s, c) => s + D(c.totalAPagar), 0));

    return {
      periodo,
      tarjetas: [
        { clave: 'recaudo', titulo: 'Recibos por aplicar', valor: recibosPorAplicar, detalle: `${saldoPorAplicar.toLocaleString('es-CO')} sin aplicar`, alerta: recibosHuerfanos > 0 ? `${recibosHuerfanos} sin identificar` : null, tab: 'recibos' },
        { clave: 'bancos', titulo: 'Movimientos sin conciliar', valor: movsSinConciliar, detalle: 'pendientes de cruce', alerta: movsSinConciliar > 0 ? 'requiere conciliación' : null, tab: 'bancos' },
        { clave: 'cartera', titulo: 'Facturas vencidas', valor: facturasVencidas.length, detalle: 'cartera en mora', alerta: facturasVencidas.length > 0 ? 'gestionar cobro' : null, tab: 'cartera' },
        { clave: 'cxp', titulo: 'Compras por pagar', valor: comprasPend.length, detalle: `${comprasPorPagar.toLocaleString('es-CO')} por pagar`, alerta: comprasVencidas > 0 ? `${comprasVencidas} vencidas` : null, tab: 'compras' },
        { clave: 'comprobantes', titulo: 'Comprobantes en borrador', valor: comprobantesBorrador, detalle: 'sin contabilizar', alerta: comprobantesBorrador > 0 ? 'revisar' : null, tab: 'asientos' },
        { clave: 'dian', titulo: 'Documentos DIAN rechazados', valor: dianRechazados, detalle: 'requieren reproceso', alerta: dianRechazados > 0 ? 'reprocesar' : null, tab: 'facturacion' },
        { clave: 'nomina', titulo: 'Nómina del mes', valor: Math.max(0, empleadosActivos - liquidacionesMes), detalle: `${empleadosActivos} empleado(s) activos`, alerta: empleadosActivos - liquidacionesMes > 0 ? 'pendiente de liquidar' : null, tab: 'nomina' },
      ],
    };
  }
}
