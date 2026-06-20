import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GeoService } from '../geo/geo.service';
import { NetworkService } from '../network/network.service';
import { PaymentsService } from '../payments/payments.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { HandoffService } from '../whatsapp/handoff.service';
import { SupportService } from '../support/support.service';
import { PrismaService } from '../prisma/prisma.service';
import { MeService } from '../me/me.service';
import { InfraService } from '../infra/infra.service';
import { ProjectExplorerService } from './project-explorer.service';
import { APP_MAP } from './knowledge';
import { config } from '../config';
import type { ToolSchema } from './llm.provider';

/** Rol efectivo del usuario que conversa (del JWT). */
export type Rol = 'admin' | 'operador' | 'tecnico' | 'contador' | 'cliente' | undefined;
const esStaff = (r: Rol) => r === 'admin' || r === 'operador';
const esContable = (r: Rol) => r === 'admin' || r === 'contador';

/**
 * Herramientas reales que el agente puede invocar (function calling). Aquí está
 * el verdadero valor del bot: responde con datos vivos de CICANET, no inventa.
 * Cada herramienta es una función pura de "argumentos -> resultado JSON".
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger('AgentToolsService');

  constructor(
    private readonly geo: GeoService,
    private readonly network: NetworkService,
    private readonly payments: PaymentsService,
    private readonly whatsapp: WhatsappService,
    private readonly handoff: HandoffService,
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
    private readonly me: MeService,
    private readonly infra: InfraService,
    private readonly explorer: ProjectExplorerService,
  ) {}

  /**
   * Esquemas que se envían al modelo (formato OpenAI tools), filtrados por rol:
   * - Cliente / anónimo: herramientas de autoservicio (cobertura, pagos, su
   *   servicio, soporte). NUNCA tocan el código ni datos de otros clientes.
   * - Admin / operador: además, herramientas de operación (CRM, red, órdenes,
   *   tickets) y un copiloto de código en SOLO LECTURA (explorar/leer/buscar).
   */
  schemas(rol?: Rol): ToolSchema[] {
    const base = this.clientSchemas();
    const tools = [...base];
    if (esStaff(rol)) tools.push(...this.staffSchemas());
    if (esContable(rol)) tools.push(...this.contableSchemas());
    if (rol === 'admin') tools.push(...this.devSchemas());
    return tools;
  }

  /** Herramientas de autoservicio (cualquier usuario). */
  private clientSchemas(): ToolSchema[] {
    return [
      {
        type: 'function',
        function: {
          name: 'verificar_cobertura',
          description:
            'Verifica si una dirección tiene cobertura de fibra óptica CICANET. Úsala cuando el cliente pregunte si llega el servicio a su casa/barrio o quiera instalar.',
          parameters: {
            type: 'object',
            properties: {
              direccion: {
                type: 'string',
                description: 'Dirección o barrio del cliente, ej. "Calle 146 #120-10, Popular, Medellín".',
              },
            },
            required: ['direccion'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'info_pagos',
          description:
            'Devuelve los medios de pago disponibles (PSE, Nequi, tarjeta, transferencia) y los datos de la cuenta de la empresa. Úsala cuando pregunten cómo o dónde pagar.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_link_pago',
          description:
            'Genera un enlace de pago seguro (Wompi) por un monto en pesos. Úsala solo cuando el cliente confirme que quiere pagar un valor concreto.',
          parameters: {
            type: 'object',
            properties: {
              monto_cop: { type: 'number', description: 'Monto a pagar en pesos colombianos (COP), ej. 58000.' },
              descripcion: { type: 'string', description: 'Concepto del pago, ej. "Factura junio 2026".' },
            },
            required: ['monto_cop'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'contacto_asesor',
          description:
            'Escala a un asesor humano: registra una solicitud que llega al panel de la empresa para que un agente contacte al cliente. Usala cuando el cliente pida hablar con una persona o el caso requiera atencion humana. NO entrega enlaces ni numeros: solo confirma que un asesor se comunicara pronto.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'info_planes',
          description:
            'Información general de planes y tecnología de CICANET. Úsala cuando pregunten por planes, velocidades o precios.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'consultar_funciones_app',
          description:
            'Devuelve el mapa REAL de la app (pestañas y acciones). ÚSALA SIEMPRE antes de explicar cómo hacer algo en la app (cambiar contraseña, pagar, ver dispositivos, etc.) para no inventar pantallas ni botones.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mi_servicio',
          description:
            'Devuelve el estado real del servicio del cliente AUTENTICADO (plan, estado, velocidad, saldo, día de corte). Úsala cuando pregunte por SU plan, SU estado, "¿tengo internet?", "¿estoy suspendido?", etc.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mis_facturas',
          description:
            'Devuelve las facturas del cliente AUTENTICADO y si tiene saldo pendiente. Úsala cuando pregunte por SUS facturas, SU deuda o quiera pagar.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'diagnosticar_servicio',
          description:
            'Diagnóstico del servicio del cliente AUTENTICADO: revisa estado, mora/suspensión y da una conclusión accionable. Úsala cuando reporte "no tengo internet", "está lento" o "no me funciona" para revisar primero su cuenta antes de escalar.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_ticket',
          description:
            'Crea un ticket de soporte cuando el cliente reporta un problema o pide una gestión que requiere seguimiento (falla técnica, cambio de clave WiFi, visita, reclamo de factura). Confirma con el cliente antes de crearlo.',
          parameters: {
            type: 'object',
            properties: {
              asunto: { type: 'string', description: 'Resumen corto del problema o solicitud.' },
              descripcion: { type: 'string', description: 'Detalle de lo que reporta el cliente.' },
              categoria: {
                type: 'string',
                description: 'Una de: tecnico, facturacion, comercial, general.',
              },
              contacto: { type: 'string', description: 'Nombre o teléfono del cliente (opcional).' },
            },
            required: ['asunto', 'descripcion'],
          },
        },
      },
    ];
  }

  /** Herramientas de operación (admin/operador): CRM, red, órdenes, tickets. */
  private staffSchemas(): ToolSchema[] {
    return [
      {
        type: 'function',
        function: {
          name: 'buscar_cliente',
          description:
            'Busca suscriptores por nombre, documento o código (CLI-xxxx). Devuelve coincidencias con su estado. Solo staff.',
          parameters: {
            type: 'object',
            properties: { consulta: { type: 'string', description: 'Nombre, documento o código del cliente.' } },
            required: ['consulta'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'resumen_cliente',
          description:
            'Resumen 360 de un cliente: identidad, servicio, plan, estado, saldo, facturas recientes y tickets. Recibe el código (CLI-xxxx), documento o UUID. Solo staff.',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Código CLI-xxxx, documento o UUID del cliente.' } },
            required: ['id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'estado_red',
          description:
            'Estado de la infraestructura: total de activos, NAPs, fibra y NAPs saturadas (semáforo). Úsala para preguntas de capacidad/operación de red. Solo staff.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'buscar_ordenes',
          description:
            'Lista órdenes de trabajo (instalaciones/visitas) con filtros opcionales por estado o técnico. Solo staff.',
          parameters: {
            type: 'object',
            properties: {
              estado: { type: 'string', description: 'asignada|en_camino|en_sitio|completada|cancelada (opcional).' },
              tecnico: { type: 'string', description: 'username del técnico (opcional).' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listar_tickets',
          description: 'Lista tickets de soporte con filtro opcional por estado. Solo staff.',
          parameters: {
            type: 'object',
            properties: { estado: { type: 'string', description: 'abierto|en_proceso|resuelto|cerrado (opcional).' } },
          },
        },
      },
    ];
  }

  /** Cica contable (solo admin/contador): consultas vivas de cartera/recaudo/estado. */
  private contableSchemas(): ToolSchema[] {
    return [
      {
        type: 'function',
        function: {
          name: 'cartera_resumen',
          description:
            'Resumen de cartera (cuentas por cobrar): total, vencido y por antigüedad (0-30/31-60/61-90/+90). Úsala cuando pregunten "cuánta cartera tenemos", "cuánto está vencido". Solo staff contable.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cartera_por_zona',
          description:
            'Cartera (vencida) agrupada por barrio o NAP. Úsala para "cartera vencida por barrio", "morosos en Popular 2", "qué NAP debe más". Solo staff contable.',
          parameters: {
            type: 'object',
            properties: { dimension: { type: 'string', description: 'barrio | nap (por defecto barrio).' } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'recaudo_del_dia',
          description:
            'Total recaudado (recibos de caja) en una fecha (hoy por defecto). Úsala para "cuánto recaudamos hoy", "recaudo de ayer". Solo staff contable.',
          parameters: {
            type: 'object',
            properties: { fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional, por defecto hoy).' } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'estado_financiero_mes',
          description:
            'Estado financiero resumido del mes: ingresos, gastos, utilidad y cartera al cierre. Úsala para "cómo vamos este mes", "utilidad de mayo". Solo staff contable.',
          parameters: {
            type: 'object',
            properties: { periodo: { type: 'string', description: 'Periodo YYYY-MM (opcional, por defecto el mes actual).' } },
          },
        },
      },
    ];
  }

  /** Copiloto de código en SOLO LECTURA (solo admin). */
  private devSchemas(): ToolSchema[] {
    return [
      {
        type: 'function',
        function: {
          name: 'explorar_proyecto',
          description:
            'Devuelve el árbol de carpetas del proyecto CICANET (monorepo: apps/api, apps/web, apps/mobile, docs). Úsala para ubicarte antes de leer o buscar archivos. Solo admin.',
          parameters: {
            type: 'object',
            properties: { ruta: { type: 'string', description: 'Subcarpeta relativa a listar (opcional, ej. "apps/api/src").' } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'buscar_en_codigo',
          description:
            'Busca un texto o símbolo en el código del proyecto (grep). Devuelve archivo, línea y fragmento. Úsala para encontrar dónde está implementada una función o configuración. Solo admin.',
          parameters: {
            type: 'object',
            properties: {
              consulta: { type: 'string', description: 'Texto o patrón a buscar.' },
              glob: { type: 'string', description: 'Filtro de ruta opcional, ej. "apps/api/**" o "*.dart".' },
            },
            required: ['consulta'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'leer_archivo',
          description:
            'Lee el contenido de un archivo de código/documentación del proyecto (con secretos censurados). Úsala tras ubicar el archivo con buscar_en_codigo o explorar_proyecto. Solo admin.',
          parameters: {
            type: 'object',
            properties: {
              ruta: { type: 'string', description: 'Ruta relativa del archivo, ej. "apps/api/src/assistant/agent-tools.service.ts".' },
              desde: { type: 'number', description: 'Línea inicial (opcional).' },
              hasta: { type: 'number', description: 'Línea final (opcional).' },
            },
            required: ['ruta'],
          },
        },
      },
    ];
  }

  /** Ejecuta una herramienta por nombre. Devuelve un objeto serializable. */
  async execute(
    name: string,
    args: Record<string, any>,
    ctx?: { creadoPor?: string; nombre?: string; clienteId?: string; rol?: Rol },
  ): Promise<unknown> {
    // Cortafuegos por rol: las herramientas de staff/dev solo para staff/admin.
    const STAFF_TOOLS = new Set(['buscar_cliente', 'resumen_cliente', 'estado_red', 'buscar_ordenes', 'listar_tickets']);
    const DEV_TOOLS = new Set(['explorar_proyecto', 'buscar_en_codigo', 'leer_archivo']);
    const CONTABLE_TOOLS = new Set(['cartera_resumen', 'cartera_por_zona', 'recaudo_del_dia', 'estado_financiero_mes']);
    if (STAFF_TOOLS.has(name) && !esStaff(ctx?.rol)) return { error: 'no_autorizado' };
    if (DEV_TOOLS.has(name) && ctx?.rol !== 'admin') return { error: 'no_autorizado' };
    if (CONTABLE_TOOLS.has(name) && !esContable(ctx?.rol)) return { error: 'no_autorizado' };

    try {
      switch (name) {
        case 'verificar_cobertura':
          return await this.verificarCobertura(String(args?.direccion ?? ''));
        case 'info_pagos':
          return this.infoPagos();
        case 'crear_link_pago':
          return await this.crearLinkPago(Number(args?.monto_cop), args?.descripcion);
        case 'contacto_asesor':
          return await this.contactoAsesor(ctx);
        case 'info_planes':
          return await this.infoPlanes();
        case 'consultar_funciones_app':
          return APP_MAP;
        case 'mi_servicio':
          return await this.miServicio(ctx?.clienteId);
        case 'mis_facturas':
          return await this.misFacturas(ctx?.clienteId);
        case 'diagnosticar_servicio':
          return await this.diagnosticarServicio(ctx?.clienteId);
        case 'crear_ticket':
          return await this.crearTicket(args, ctx);
        case 'buscar_cliente':
          return await this.buscarCliente(String(args?.consulta ?? ''));
        case 'resumen_cliente':
          return await this.resumenCliente(String(args?.id ?? ''));
        case 'estado_red':
          return this.estadoRed();
        case 'buscar_ordenes':
          return await this.buscarOrdenes(args?.estado, args?.tecnico);
        case 'listar_tickets':
          return await this.listarTickets(args?.estado);
        case 'cartera_resumen':
          return await this.carteraResumen();
        case 'cartera_por_zona':
          return await this.carteraPorZona(args?.dimension);
        case 'recaudo_del_dia':
          return await this.recaudoDelDia(args?.fecha);
        case 'estado_financiero_mes':
          return await this.estadoFinancieroMes(args?.periodo);
        case 'explorar_proyecto':
          return this.explorer.available
            ? (args?.ruta ? this.explorer.listDir(String(args.ruta)) : { ok: true, arbol: this.explorer.tree(2) })
            : { ok: false, mensaje: 'El acceso al código no está disponible en este entorno.' };
        case 'buscar_en_codigo':
          return this.explorer.search(String(args?.consulta ?? ''), { glob: args?.glob });
        case 'leer_archivo':
          return this.explorer.readFile(String(args?.ruta ?? ''), { desde: args?.desde, hasta: args?.hasta });
        default:
          return { error: `herramienta_desconocida: ${name}` };
      }
    } catch (e: any) {
      this.logger.warn(`Tool ${name} falló: ${e.message}`);
      return { error: 'no_se_pudo_ejecutar', detalle: e.message };
    }
  }

  // --- Implementaciones ---

  private async verificarCobertura(direccion: string) {
    if (!direccion || direccion.length < 4) {
      return { ok: false, mensaje: 'Necesito una dirección o barrio para verificar.' };
    }
    const candidatos = await this.geo.geocode(direccion);
    const c = candidatos?.[0];
    if (!c) {
      return { ok: false, mensaje: 'No pude ubicar esa dirección. Pide una más específica con barrio.' };
    }
    const cobertura = this.network.checkCoverage(c.lng, c.lat);
    return {
      ok: true,
      direccionInterpretada: c.displayName,
      cobertura: cobertura.cobertura,
      estado: cobertura.estado,
      mensaje: cobertura.mensaje,
      napCercano: cobertura.napCercano
        ? { nombre: cobertura.napCercano.nombre, metros: cobertura.napCercano.metros, puertosLibres: cobertura.napCercano.libres }
        : null,
    };
  }

  private infoPagos() {
    const manual = this.support; // no usado directamente aquí
    void manual;
    return {
      enLinea: !!config.wompi.publicKey,
      medios: ['PSE (todos los bancos)', 'Nequi', 'Tarjeta crédito/débito', 'Transferencia Bancolombia'],
      procesador: 'Wompi (Grupo Bancolombia)',
      transferenciaManual: {
        nequi: config.wompi.nequiEmpresa || null,
        bancolombia: config.wompi.bancolombiaEmpresa || null,
        titular: 'CICANET',
      },
      comoPagar:
        'Desde la app CICANET: Facturas → Pagar → elegir medio. El pago se acredita y el servicio se reactiva automáticamente.',
    };
  }

  private async crearLinkPago(montoCop: number, descripcion?: string) {
    if (!Number.isFinite(montoCop) || montoCop < 1500) {
      return { ok: false, mensaje: 'Indica un monto válido en pesos (mínimo $1.500).' };
    }
    const checkout = await this.payments.createCheckout({
      montoCents: Math.round(montoCop * 100),
      descripcion: descripcion || 'Pago CICANET',
    });
    return {
      ok: true,
      url: checkout.checkoutUrl,
      referencia: checkout.referencia,
      monto: montoCop,
      mensaje: 'Comparte este enlace seguro de Wompi para completar el pago.',
    };
  }

  private async contactoAsesor(ctx?: { clienteId?: string; nombre?: string }) {
    // Registrar la solicitud de asesor (handoff) para el panel de WhatsApp.
    // Best-effort: si falla, igual confirmamos al cliente.
    try {
      let telefono: string | undefined;
      let nombre = ctx?.nombre;
      if (ctx?.clienteId) {
        const cli = await this.prisma.cliente.findUnique({ where: { id: ctx.clienteId }, select: { telefonoMovil: true, nombre: true } });
        telefono = cli?.telefonoMovil ?? undefined;
        nombre = nombre || cli?.nombre || undefined;
      }
      await this.handoff.crear({ clienteId: ctx?.clienteId, nombre, telefono, motivo: 'El cliente pidió hablar con un asesor', origen: 'bot' });
    } catch (e: any) {
      this.logger.warn(`No se registró el handoff de asesor: ${e.message}`);
    }

    // NO se entrega enlace ni se inicia chat: el agente contacta al cliente.
    return {
      ok: true,
      registrado: true,
      // El modelo debe limitarse a confirmar que un asesor se comunicará pronto.
      mensaje: 'Listo, registré tu solicitud. Un asesor de CICANET se comunicará contigo muy pronto.',
      instruccion_para_el_modelo: 'Responde UNICAMENTE que un asesor se comunicara con el cliente pronto. NO entregues enlaces de WhatsApp ni numeros ni digas que envias un mensaje.',
    };
  }

  /** Tarifario REAL desde la base. Si no hay planes cargados, lo indica sin inventar. */
  private async infoPlanes() {
    const planes = await this.prisma.plan.findMany({
      where: { activo: true },
      orderBy: { velocidadBajada: 'asc' },
      take: 12,
    });
    if (!planes.length) {
      return {
        tecnologia: 'FTTH (fibra óptica hasta el hogar)',
        segmentos: ['Hogar', 'Empresarial'],
        planes: [],
        nota: 'Aún no hay un tarifario cargado. Un asesor confirma el plan y precio según la zona y el uso.',
      };
    }
    return {
      tecnologia: 'FTTH (fibra óptica hasta el hogar)',
      moneda: 'COP',
      planes: planes.map((p) => ({
        nombre: p.nombre,
        bajada: `${p.velocidadBajada} Mbps`,
        subida: `${p.velocidadSubida} Mbps`,
        precioMensual: Number(p.precio),
        tecnologia: p.tecnologia,
      })),
      nota: 'Precios mensuales antes de impuestos. El asesor confirma promociones vigentes e instalación.',
    };
  }

  private async miServicio(clienteId?: string) {
    if (!clienteId) {
      return { ok: false, requiereLogin: true, mensaje: 'Para ver tu servicio inicia sesión con tu documento en la app.' };
    }
    try {
      const s = await this.me.servicio(clienteId);
      return { ok: true, ...s };
    } catch {
      return { ok: false, mensaje: 'No encontré un servicio asociado a tu cuenta.' };
    }
  }

  private async misFacturas(clienteId?: string) {
    if (!clienteId) {
      return { ok: false, requiereLogin: true, mensaje: 'Para ver tus facturas inicia sesión con tu documento en la app.' };
    }
    const facturas = await this.me.facturas(clienteId);
    const pendiente = await this.me.facturaPendiente(clienteId);
    return {
      ok: true,
      total: facturas.length,
      pendiente: pendiente
        ? { periodo: pendiente.periodo, total: pendiente.total, vence: pendiente.fechaVencimiento }
        : null,
      facturas: facturas.slice(0, 6),
    };
  }

  /** Diagnóstico del servicio del cliente autenticado (estado + mora). */
  private async diagnosticarServicio(clienteId?: string) {
    if (!clienteId) {
      return { ok: false, requiereLogin: true, mensaje: 'Para diagnosticar tu servicio inicia sesión con tu documento en la app.' };
    }
    let s;
    try {
      s = await this.me.servicio(clienteId);
    } catch {
      return { ok: false, mensaje: 'No encontré un servicio asociado a tu cuenta.' };
    }
    const pendiente = await this.me.facturaPendiente(clienteId);
    const suspendido = s.estadoServicio === 'suspendido' || s.estadoServicio === 'cortado' || s.estadoCliente === 'suspendido' || s.estadoCliente === 'moroso';
    let causaProbable: string;
    let accion: string;
    if (suspendido && (s.saldo > 0 || pendiente)) {
      causaProbable = 'servicio suspendido por factura pendiente';
      accion = 'Al registrar el pago, el servicio se reactiva automáticamente. Puedo generarte el link de pago.';
    } else if (s.activo) {
      causaProbable = 'el servicio figura ACTIVO en el sistema; la falla parece local (equipo/WiFi)';
      accion = 'Revisa las luces del equipo (PON fija/verde, LOS apagada), reinícialo 30s. Si sigue igual, creo un ticket técnico.';
    } else {
      causaProbable = `estado del servicio: ${s.estadoServicio}`;
      accion = 'Conviene una revisión técnica. Puedo crear un ticket o conectarte con un asesor.';
    }
    return {
      ok: true,
      plan: s.plan,
      estadoServicio: s.estadoServicio,
      activo: s.activo,
      saldo: s.saldo,
      facturaPendiente: pendiente ? { periodo: pendiente.periodo, total: pendiente.total, vence: pendiente.fechaVencimiento } : null,
      causaProbable,
      accionRecomendada: accion,
    };
  }

  // --- Herramientas de operación (staff) ---

  private async buscarCliente(consulta: string) {
    const q = consulta.trim();
    if (q.length < 2) return { ok: false, mensaje: 'Indica al menos 2 caracteres.' };
    const clientes = await this.prisma.cliente.findMany({
      where: {
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { documento: { contains: q } },
          { codigo: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { creadoEn: 'desc' },
    });
    return {
      ok: true,
      total: clientes.length,
      clientes: clientes.map((c) => ({ codigo: c.codigo, nombre: c.nombre, documento: c.documento, estado: c.estado, email: c.email })),
    };
  }

  private async resumenCliente(idRaw: string) {
    const v = (idRaw || '').trim();
    if (!v) return { ok: false, mensaje: 'Indica el código, documento o UUID del cliente.' };
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const cliente = await this.prisma.cliente.findFirst({
      where: esUuid ? { id: v } : { OR: [{ codigo: { equals: v, mode: 'insensitive' } }, { documento: v }] },
      include: {
        servicios: { include: { punto: true }, orderBy: { creadoEn: 'asc' } },
      },
    });
    if (!cliente) return { ok: false, mensaje: 'No encontré ese cliente.' };
    const servicioIds = cliente.servicios.map((s) => s.id);
    const facturas = servicioIds.length
      ? await this.prisma.factura.findMany({ where: { servicioId: { in: servicioIds } }, orderBy: { fechaEmision: 'desc' }, take: 5 })
      : [];
    const tickets = await this.prisma.ticket.findMany({ where: { clienteId: cliente.id }, orderBy: { creadoEn: 'desc' }, take: 5 });
    const s = cliente.servicios[0];
    return {
      ok: true,
      cliente: { codigo: cliente.codigo, nombre: cliente.nombre, documento: cliente.documento, estado: cliente.estado, email: cliente.email, telefono: cliente.telefonoMovil },
      servicio: s
        ? { plan: s.planNombre, estado: s.estado, tecnologia: s.tecnologia, tarifa: Number(s.tarifa ?? 0), saldo: Number(s.saldo ?? 0), direccion: s.punto?.direccion ?? null, barrio: s.punto?.barrio ?? null, napId: s.napId ?? null }
        : null,
      facturas: facturas.map((f) => ({ periodo: f.periodo, total: Number(f.total), estado: f.estado, vence: f.fechaVencimiento?.toISOString().slice(0, 10) ?? null })),
      ticketsAbiertos: tickets.filter((t) => t.estado === 'abierto' || t.estado === 'en_proceso').length,
      tickets: tickets.map((t) => ({ codigo: t.codigo, asunto: t.asunto, estado: t.estado, categoria: t.categoria })),
    };
  }

  private estadoRed() {
    const bundle = this.infra.getBundle();
    const naps = bundle.assets.features.filter((f: any) => f.properties.tipo === 'NAP');
    const saturadas = naps
      .filter((f: any) => f.properties.semaforo === 'rojo' || (f.properties.puertosLibres != null && f.properties.puertosLibres <= 1))
      .map((f: any) => ({ nombre: f.properties.nombre, puertosLibres: f.properties.puertosLibres, semaforo: f.properties.semaforo }));
    return {
      ok: true,
      activos: bundle.stats.activos,
      naps: naps.length,
      fibras: bundle.stats.fibras,
      metrosFibra: bundle.stats.metrosFibra,
      napsSaturadas: saturadas.length,
      detalleSaturadas: saturadas.slice(0, 10),
    };
  }

  private async buscarOrdenes(estado?: string, tecnico?: string) {
    const where: Record<string, unknown> = {};
    if (estado) where.estado = String(estado);
    if (tecnico) where.tecnico = String(tecnico);
    const ordenes = await this.prisma.ordenTrabajo.findMany({
      where,
      orderBy: [{ estado: 'asc' }, { creadoEn: 'desc' }],
      take: 20,
    });
    return {
      ok: true,
      total: ordenes.length,
      ordenes: ordenes.map((o) => ({ codigo: o.codigo, tipo: o.tipo, estado: o.estado, titulo: o.titulo, tecnico: o.tecnico, direccion: o.direccion, prioridad: o.prioridad })),
    };
  }

  private async listarTickets(estado?: string) {
    const where: Record<string, unknown> = {};
    if (estado) where.estado = String(estado);
    const tickets = await this.prisma.ticket.findMany({ where, orderBy: { creadoEn: 'desc' }, take: 20 });
    return {
      ok: true,
      total: tickets.length,
      tickets: tickets.map((t) => ({ codigo: t.codigo, asunto: t.asunto, estado: t.estado, categoria: t.categoria, origen: t.origen })),
    };
  }

  private async crearTicket(args: Record<string, any>, ctx?: { creadoPor?: string; nombre?: string }) {
    const asunto = String(args?.asunto ?? '').trim();
    const descripcion = String(args?.descripcion ?? '').trim();
    if (asunto.length < 3 || descripcion.length < 3) {
      return { ok: false, mensaje: 'Falta el asunto o la descripción del problema.' };
    }
    const cats = ['tecnico', 'facturacion', 'comercial', 'general'];
    const categoria = cats.includes(String(args?.categoria)) ? String(args.categoria) : 'general';
    const codigo = `TCK-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const contacto = args?.contacto ? String(args.contacto).slice(0, 120) : ctx?.nombre ?? null;
    const ticket = await this.prisma.ticket.create({
      data: {
        codigo,
        asunto: asunto.slice(0, 200),
        descripcion: descripcion.slice(0, 2000),
        categoria,
        contacto,
        origen: 'asistente',
        creadoPor: ctx?.creadoPor ?? null,
      },
    });
    this.logger.log(`Ticket creado ${ticket.codigo} (${categoria}) por ${ctx?.creadoPor ?? 'anónimo'}`);
    return {
      ok: true,
      codigo: ticket.codigo,
      categoria,
      mensaje: `Ticket ${ticket.codigo} creado. Nuestro equipo le dará seguimiento.`,
    };
  }

  // --- Cica contable (admin/contador): consultas vivas sobre el ledger/cartera ---

  private bucketDe(dias: number): string {
    if (dias <= 0) return 'porVencer';
    if (dias <= 30) return 'd1_30';
    if (dias <= 60) return 'd31_60';
    if (dias <= 90) return 'd61_90';
    return 'd90mas';
  }

  /** Carga facturas pendientes/vencidas con su saldo (total − pagos aprobados). */
  private async facturasConSaldo() {
    const facturas = await this.prisma.factura.findMany({
      where: { estado: { in: ['pendiente', 'vencida'] } },
      include: {
        pagos: { where: { estado: 'aprobado' }, select: { monto: true } },
        servicio: { include: { punto: { select: { barrio: true } } } },
      },
      take: 50000,
    });
    const hoy = Date.now();
    return facturas
      .map((f) => {
        const pagado = f.pagos.reduce((s, p) => s + Number(p.monto ?? 0), 0);
        const saldo = Math.round((Number(f.total) - pagado) * 100) / 100;
        const dias = Math.floor((hoy - f.fechaVencimiento.getTime()) / 86_400_000);
        return { saldo, dias, barrio: f.servicio.punto?.barrio ?? 'Sin barrio', napId: f.servicio.activoNapId ?? f.servicio.napId ?? 'Sin NAP' };
      })
      .filter((f) => f.saldo > 0);
  }

  private async carteraResumen() {
    const filas = await this.facturasConSaldo();
    const buckets: Record<string, number> = { porVencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90mas: 0 };
    let total = 0;
    let vencido = 0;
    for (const f of filas) {
      const b = this.bucketDe(f.dias);
      buckets[b] = Math.round((buckets[b] + f.saldo) * 100) / 100;
      total = Math.round((total + f.saldo) * 100) / 100;
      if (f.dias > 0) vencido = Math.round((vencido + f.saldo) * 100) / 100;
    }
    return { ok: true, total, vencido, buckets, facturasConSaldo: filas.length };
  }

  private async carteraPorZona(dimension?: string) {
    const dim = dimension === 'nap' ? 'nap' : 'barrio';
    const filas = await this.facturasConSaldo();
    const map = new Map<string, { dimension: string; vencido: number; total: number }>();
    for (const f of filas) {
      const key = dim === 'nap' ? f.napId : f.barrio;
      const acc = map.get(key) ?? { dimension: key, vencido: 0, total: 0 };
      acc.total = Math.round((acc.total + f.saldo) * 100) / 100;
      if (f.dias > 0) acc.vencido = Math.round((acc.vencido + f.saldo) * 100) / 100;
      map.set(key, acc);
    }
    const out = [...map.values()].sort((a, b) => b.vencido - a.vencido).slice(0, 15);
    return { ok: true, dimension: dim, zonas: out };
  }

  private async recaudoDelDia(fechaRaw?: string) {
    const base = fechaRaw ? new Date(fechaRaw) : new Date();
    if (Number.isNaN(base.getTime())) return { ok: false, mensaje: 'Fecha inválida (usa YYYY-MM-DD).' };
    const desde = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    const hasta = new Date(desde.getTime() + 86_400_000);
    const recibos = await this.prisma.reciboCaja.findMany({
      where: { fecha: { gte: desde, lt: hasta }, estado: { not: 'anulado' } },
      select: { montoRecibido: true, medioPago: true },
    });
    const total = Math.round(recibos.reduce((s, r) => s + Number(r.montoRecibido ?? 0), 0) * 100) / 100;
    const porMedio: Record<string, number> = {};
    for (const r of recibos) porMedio[r.medioPago] = Math.round(((porMedio[r.medioPago] ?? 0) + Number(r.montoRecibido ?? 0)) * 100) / 100;
    return { ok: true, fecha: desde.toISOString().slice(0, 10), total, recibos: recibos.length, porMedio };
  }

  private async estadoFinancieroMes(periodoRaw?: string) {
    const d = new Date();
    const periodo = /^\d{4}-\d{2}$/.test(String(periodoRaw)) ? String(periodoRaw) : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const movs = await this.prisma.movimientoContable.findMany({
      where: { asiento: { periodo, estado: 'contabilizado' } },
      include: { cuenta: { select: { clase: true } } },
      take: 50000,
    });
    let ingresos = 0;
    let gastos = 0;
    for (const m of movs) {
      const clase = m.cuenta?.clase ?? 0;
      if (clase === 4) ingresos += Number(m.credito ?? 0) - Number(m.debito ?? 0);
      if (clase === 5 || clase === 6) gastos += Number(m.debito ?? 0) - Number(m.credito ?? 0);
    }
    ingresos = Math.round(ingresos * 100) / 100;
    gastos = Math.round(gastos * 100) / 100;
    const cartera = (await this.carteraResumen()).total;
    return { ok: true, periodo, ingresos, gastos, utilidad: Math.round((ingresos - gastos) * 100) / 100, carteraVigente: cartera };
  }
}
