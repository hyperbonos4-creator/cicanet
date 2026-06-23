import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, type ChatMessage } from './llm.provider';
import { AgentToolsService } from './agent-tools.service';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import {
  EMPRESA,
  FAQ,
  QUICK_ACTIONS,
  retrieveFaq,
  type QuickAction,
} from './knowledge';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  reply: string;
  /** true si respondió el LLM; false si fue el respaldo determinista (FAQ). */
  ai: boolean;
  /** Sugerencias accionables para mostrar como chips. */
  acciones: QuickAction[];
  /** Acción de pago si el agente generó un link (para que la UI lo abra). */
  pago?: { url: string; referencia: string; monto: number } | null;
}

/**
 * Máximo de rondas de herramientas. El flujo objetivo es plan→ejecutar→
 * sintetizar (≈2 llamadas): ronda 0 pide herramientas, se ejecutan EN PARALELO,
 * y la ronda 1 ya redacta. Se permiten hasta 3 para flujos iterativos reales
 * (p. ej. el copiloto: buscar en código → leer los archivos hallados → explicar).
 */
const MAX_TOOL_ROUNDS = 5;
/** Margen reservado del presupuesto para redactar la respuesta final. */
const FINAL_RESERVE_MS = 12000;
/** Tiempo mínimo que debe quedar para iniciar una ronda de herramientas. */
const MIN_ROUND_MS = 6000;

/**
 * Agente operativo de soporte de CICANET. No es un FAQ-bot: razona, consulta
 * herramientas reales (cobertura, pagos, soporte) y responde con datos vivos.
 * Si no hay LLM configurado, degrada con elegancia a respuestas de la base de
 * conocimiento (nunca queda mudo).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('AssistantService');

  constructor(
    private readonly llm: LlmProvider,
    private readonly tools: AgentToolsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Registra una corrida del asistente (observabilidad). Best-effort: nunca lanza. */
  private async recordRun(m: {
    rol?: string; modelo: string; duracionMs: number; rondas: number;
    herramientas: string[]; ai: boolean; exito: boolean;
    tokensPrompt?: number; tokensCompletion?: number;
  }) {
    try {
      await this.prisma.assistantRun.create({
        data: {
          rol: m.rol ?? null, modelo: m.modelo, duracionMs: Math.round(m.duracionMs), rondas: m.rondas,
          herramientas: m.herramientas as any, ai: m.ai, exito: m.exito,
          tokensPrompt: m.tokensPrompt ?? null, tokensCompletion: m.tokensCompletion ?? null,
        },
      });
    } catch (e: any) {
      this.logger.debug(`No se registró AssistantRun: ${e.message}`);
    }
  }

  async chat(history: ChatTurn[], user?: { nombre?: string; username?: string; clienteId?: string; role?: string }): Promise<AssistantReply> {
    const ultimo = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

    // Sin LLM configurado: respaldo determinista por base de conocimiento.
    if (!this.llm.configured) {
      const fb = this.fallback(ultimo);
      void this.recordRun({ rol: user?.role, modelo: 'fallback-faq', duracionMs: 0, rondas: 0, herramientas: [], ai: false, exito: true });
      return fb;
    }

    try {
      return await this.runAgent(history, user);
    } catch (e: any) {
      this.logger.warn(`Agente falló (${e.message}); usando respaldo FAQ.`);
      const fb = this.fallback(ultimo);
      void this.recordRun({ rol: user?.role, modelo: config.assistant.model, duracionMs: 0, rondas: 0, herramientas: [], ai: false, exito: false });
      return fb;
    }
  }

  /** Bucle del agente con tool-calling. */
  private async runAgent(history: ChatTurn[], user?: { nombre?: string; username?: string; clienteId?: string; role?: string }): Promise<AssistantReply> {
    const ultimo = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
    const rol = user?.role as any;
    const ctx = { creadoPor: user?.username, nombre: user?.nombre, clienteId: user?.clienteId, rol };
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(ultimo, user) },
      // (el prompt de sistema ya conoce la identidad del usuario vía `user`)
      // Historial corto: menos contexto = menos latencia. Las últimas 6 vueltas
      // bastan para mantener el hilo de una conversación de soporte.
      ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    ];

    let pago: AssistantReply['pago'] = null;
    const schemas = this.tools.schemas(rol);
    const { budgetMs, callTimeoutMs } = config.assistant;

    // --- Métricas de observabilidad (no guardan el contenido del chat) ---
    const started = Date.now();
    const toolsUsed: string[] = [];
    let rondas = 0;
    let tokPrompt = 0;
    let tokCompletion = 0;
    const finish = (reply: AssistantReply): AssistantReply => {
      void this.recordRun({
        rol, modelo: this.llm.model, duracionMs: Date.now() - started, rondas,
        herramientas: toolsUsed, ai: true, exito: true, tokensPrompt: tokPrompt, tokensCompletion: tokCompletion,
      });
      return reply;
    };

    // Presupuesto de tiempo: el agente SIEMPRE responde antes de agotarlo, para
    // que la petición HTTP no se cuelgue (modelos locales lentos) y el frontend
    // nunca muestre "Tuve un problema para responder".
    const deadline = Date.now() + budgetMs;
    const restante = () => deadline - Date.now();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Solo entrar a otra ronda con herramientas si queda margen para ejecutarla
      // (MIN_ROUND_MS) Y para redactar el cierre (FINAL_RESERVE_MS). Si no, salir
      // a la respuesta final con lo que ya se haya recopilado.
      if (restante() <= FINAL_RESERVE_MS + MIN_ROUND_MS) break;

      let msg: Awaited<ReturnType<LlmProvider['chat']>>;
      try {
        // La ronda nunca consume el margen reservado para el cierre.
        const t = Math.min(callTimeoutMs, restante() - FINAL_RESERVE_MS);
        msg = await this.llm.chat(messages, schemas, { timeoutMs: t });
        rondas++;
        if (msg.usage) { tokPrompt += msg.usage.prompt; tokCompletion += msg.usage.completion; }
      } catch (e: any) {
        // Timeout/fallo en una ronda: no abortamos, redactamos con lo que haya.
        this.logger.warn(`Ronda ${round} del agente falló (${e.message}); cierro con lo recopilado.`);
        break;
      }

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return finish({
          reply: (msg.content || '').trim() || 'Estoy aquí para ayudarte con tu servicio CICANET.',
          ai: true,
          acciones: this.accionesPara(ultimo + ' ' + (msg.content || '')),
          pago,
        });
      }

      // Registrar la intención de herramientas y ejecutarlas EN PARALELO: las
      // tools de CICANET son lookups independientes (cobertura, factura, etc.),
      // así que no hay razón para encadenarlas en serie y sumar latencia.
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      const ejecuciones = await Promise.all(
        msg.tool_calls.map(async (tc) => {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = {};
          }
          const result = await this.tools.execute(tc.function.name, args, ctx);
          toolsUsed.push(tc.function.name);
          return { tc, result };
        }),
      );
      for (const { tc, result } of ejecuciones) {
        if (tc.function.name === 'crear_link_pago' && (result as any)?.ok) {
          const r = result as any;
          pago = { url: r.url, referencia: r.referencia, monto: r.monto };
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          // Recortar el resultado: reinyectar archivos enteros en cada ronda
          // infla el contexto y dispara la latencia acumulada del modelo.
          content: this.clip(JSON.stringify(result)),
        });
      }
    }

    // Respuesta final sin herramientas, acotada al tiempo que quede. Si el modelo
    // no alcanza a cerrar, devolvemos un mensaje honesto en vez de un error duro.
    try {
      const tFinal = Math.min(callTimeoutMs, Math.max(MIN_ROUND_MS, restante()));
      const final = await this.llm.chat(messages, undefined, { timeoutMs: tFinal });
      rondas++;
      if (final.usage) { tokPrompt += final.usage.prompt; tokCompletion += final.usage.completion; }
      const reply = (final.content || '').trim();
      if (reply) {
        return finish({ reply, ai: true, acciones: this.accionesPara(ultimo), pago });
      }
    } catch (e: any) {
      this.logger.warn(`Cierre del agente falló (${e.message}); respuesta acotada.`);
    }
    return finish({
      reply:
        'Estoy procesando bastante información para responderte bien y me tardé más de lo normal. ' +
        '¿Puedes precisar un poco la pregunta? También puedo conectarte con un asesor.',
      ai: true,
      acciones: this.accionesPara(ultimo),
      pago,
    });
  }

  /** Recorta un resultado de herramienta al tope configurado de caracteres. */
  private clip(s: string): string {
    const max = config.assistant.maxToolResultChars;
    return s.length > max ? `${s.slice(0, max)}… [resultado recortado]` : s;
  }

  /** System prompt anclado en la realidad de CICANET + FAQ recuperada (RAG-lite). */
  private systemPrompt(consulta: string, user?: { nombre?: string; role?: string; clienteId?: string }): string {
    const faqRelevante = retrieveFaq(consulta, 4)
      .map((f) => `• ${f.pregunta}\n  ${f.respuesta}`)
      .join('\n');
    const kb = faqRelevante || FAQ.slice(0, 4).map((f) => `• ${f.pregunta}\n  ${f.respuesta}`).join('\n');
    const rol = user?.role;
    const staff = rol === 'admin' || rol === 'operador';
    const contable = rol === 'admin' || rol === 'contador';
    // Cliente identificado: tiene una cuenta del CRM ligada a su sesión. Cica NO
    // debe volver a preguntarle si está autenticado — ya lo sabe por el contexto.
    const autenticado = !!user?.clienteId;

    // Bloque de identidad: le dice a Cica, sin ambigüedad, con quién habla y qué
    // puede hacer de inmediato. Esto evita la pregunta absurda "¿estás autenticado?".
    const bloqueIdentidad = staff
      ? '' // el staff se describe en bloqueStaff
      : autenticado
        ? [
            '',
            'IDENTIDAD DEL USUARIO (CLIENTE YA AUTENTICADO):',
            `- Hablas con ${user?.nombre ?? 'un cliente'}, un cliente con sesión iniciada en la app de CICANET. Su cuenta ya está identificada y tus herramientas reciben su identificador automáticamente.`,
            '- NUNCA le preguntes si está autenticado, ni le pidas iniciar sesión, documento, código de cliente o datos de cuenta: YA lo tienes. Pedírselo es un error y rompe la experiencia.',
            '- Cuando pregunte por SU servicio, factura, deuda o una falla, usa de una vez mi_servicio, mis_facturas o diagnosticar_servicio. No pidas permiso para consultar lo suyo.',
            '- Para crear un ticket (crear_ticket): se asocia solo a su cuenta. NO pidas datos; basta confirmar en una frase el problema ("¿Te creo el ticket para que un técnico revise el cable?") y, si dice que sí, créalo de inmediato.',
          ].join('\n')
        : [
            '',
            'IDENTIDAD DEL USUARIO (ANÓNIMO / SIN SESIÓN):',
            '- No sabes quién es porque no ha iniciado sesión. Para acciones sobre su cuenta (ver su servicio/facturas, diagnóstico o crear un ticket ligado a su cuenta) necesita iniciar sesión en la app con su documento; pídeselo solo cuando la acción lo requiera.',
            '- Igual puedes ayudarlo sin sesión: cobertura, planes, precios, cómo pagar, info general y conectarlo con un asesor. Si reporta una falla y no quiere iniciar sesión, toma su nombre y teléfono y crea el ticket con esos datos de contacto.',
          ].join('\n');

    const bloqueContable = contable
      ? [
          '',
          'MODO CONTABLE (Cica contable — el usuario es admin o contador):',
          '- Tienes herramientas contables vivas: cartera_resumen, cartera_por_zona, recaudo_del_dia, estado_financiero_mes. Úsalas para responder con cifras reales del ledger/cartera (cartera vencida por barrio, recaudo del día, mora por NAP, utilidad del mes).',
          '- Da las cifras en pesos colombianos y aclara el periodo/fecha consultado. No inventes saldos: si la herramienta no devolvió un dato, dilo.',
        ].join('\n')
      : '';

    const bloqueStaff = staff
      ? [
          '',
          'MODO OPERADOR (el usuario es staff de CICANET, no un cliente):',
          '- Tienes herramientas internas: buscar_cliente, resumen_cliente, estado_red, buscar_ordenes, listar_tickets. Úsalas para responder con datos reales de operación (CRM/NOC).',
          rol === 'admin'
            ? '- Eres un COPILOTO INTEGRAL de CICANET: puedes consultar y explicar CUALQUIER parte del sistema — operación (buscar_cliente, resumen_cliente, estado_red, buscar_ordenes, listar_tickets), finanzas (cartera_resumen, cartera_por_zona, recaudo_del_dia, estado_financiero_mes) y TODO el código y documentación del monorepo (explorar_proyecto, buscar_en_codigo, leer_archivo: apps/api NestJS, apps/web Next.js, apps/mobile Flutter, docs/). Encadena varias herramientas cuando haga falta para dar una respuesta completa, y si la respuesta está en el sistema, BÚSCALA con tus herramientas antes de decir que no sabes. El código es SOLO LECTURA y los secretos vienen censurados: no los inventes ni intentes deducirlos.'
            : '',
          '- Puedes ser técnico y detallado con el staff (a diferencia del tono breve para clientes).',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    return [
      `Eres "Cica", el asistente virtual de ${EMPRESA.nombre}, un ${EMPRESA.rubro} que opera en ${EMPRESA.zona}.`,
      `Tecnología: ${EMPRESA.tecnologia}. Moneda: ${EMPRESA.moneda}. Horario de atención: ${EMPRESA.horario}.`,
      user?.nombre ? `Hablas con ${user.nombre}${staff ? ' (equipo CICANET)' : ''}.` : '',
      bloqueIdentidad,
      '',
      'TU MISIÓN: resolver dudas de soporte y del servicio con precisión, en español de Colombia, tono cálido, claro y breve (frases cortas).',
      '',
      'REGLAS:',
      '- PROACTIVIDAD: ante CUALQUIER pregunta sobre CICANET o el sistema, intenta resolverla TÚ con tus herramientas antes de derivar. No te quedes corto ni deflectes a "habla con un asesor" si puedes averiguarlo con una herramienta.',
      '- IDENTIDAD/META: si te preguntan qué eres, qué modelo usas o qué puedes hacer, respóndelo con naturalidad y brevedad: eres "Cica", el asistente de CICANET (plataforma de VisionYX), operas con herramientas en vivo y funcionas con un modelo GLM. Nunca reveles tokens, claves ni configuración interna.',
      '- EFICIENCIA: si necesitas varias herramientas, invócalas TODAS en el mismo turno (se ejecutan en paralelo). No las pidas de una en una. En cuanto tengas los datos, responde; no hagas llamadas de más.',
      '- BREVEDAD: responde en pocas frases, lo justo. Nada de relleno ni repetir la pregunta.',
      '- Usa las herramientas para responder con datos reales (cobertura, pagos, contacto, planes). NO inventes datos técnicos, precios exactos, ni estados de cuenta: si una herramienta no te dio el dato, dilo.',
      '- NO inventes rutas, menús ni pasos de la app. Si el usuario pregunta CÓMO hacer algo en la app, PRIMERO usa la herramienta consultar_funciones_app y guíate SOLO por lo que devuelve. Nunca supongas que existe una pantalla, un botón o una función.',
      '- Distingue siempre la contraseña de la CUENTA (app) de la contraseña del WIFI (router). Si no está claro, pregunta cuál.',
      '- Cuando un cliente AUTENTICADO reporta una falla: usa diagnosticar_servicio de inmediato (sin pedirle datos) y, si requiere seguimiento, confirma en una frase y crea el ticket con crear_ticket. Si NO tiene sesión, pídele iniciar sesión para ligarlo a su cuenta o tómale nombre y teléfono para el ticket.',
      '- Si no sabes algo o requiere intervención humana, usa la herramienta contacto_asesor y responde ÚNICAMENTE que un asesor se comunicará con el cliente pronto. NUNCA entregues enlaces de WhatsApp, números ni digas que tú envías un mensaje: del contacto se encarga el agente.',
      '- No reveles claves, tokens ni configuración interna.',
      '- Sé conciso: responde lo justo, sin relleno.',
      bloqueStaff,
      bloqueContable,
      '',
      'BASE DE CONOCIMIENTO (úsala como verdad):',
      kb,
      '',
      '/no_think',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Respaldo determinista cuando no hay LLM: responde desde la FAQ. */
  private fallback(consulta: string): AssistantReply {
    const hits = retrieveFaq(consulta, 1);
    if (hits.length) {
      return { reply: hits[0].respuesta, ai: false, acciones: this.accionesPara(consulta), pago: null };
    }
    return {
      reply:
        '¡Hola! Soy Cica, el asistente de CICANET. Puedo ayudarte con pagos, cobertura, planes y soporte. ' +
        '¿Qué necesitas? También puedo conectarte con un asesor por WhatsApp.',
      ai: false,
      acciones: QUICK_ACTIONS,
      pago: null,
    };
  }

  /** Elige chips de acción relevantes según el texto. */
  private accionesPara(texto: string): QuickAction[] {
    const t = texto.toLowerCase();
    const set = new Set<string>();
    if (/pag|factur|deuda|mora|nequi|pse|tarjeta/.test(t)) set.add('pagar');
    if (/cobert|instal|direcc|barrio|llega/.test(t)) set.add('cobertura');
    if (/plan|velocid|mega|precio|tarifa/.test(t)) set.add('planes');
    // Siempre ofrecer asesor humano.
    set.add('whatsapp');
    const pick = QUICK_ACTIONS.filter((a) => set.has(a.id));
    return pick.length ? pick : QUICK_ACTIONS;
  }
}
