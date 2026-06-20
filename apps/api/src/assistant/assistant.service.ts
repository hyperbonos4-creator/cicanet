import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, type ChatMessage } from './llm.provider';
import { AgentToolsService } from './agent-tools.service';
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
const MAX_TOOL_ROUNDS = 3;
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
  ) {}

  async chat(history: ChatTurn[], user?: { nombre?: string; username?: string; clienteId?: string; role?: string }): Promise<AssistantReply> {
    const ultimo = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

    // Sin LLM configurado: respaldo determinista por base de conocimiento.
    if (!this.llm.configured) {
      return this.fallback(ultimo);
    }

    try {
      return await this.runAgent(history, user);
    } catch (e: any) {
      this.logger.warn(`Agente falló (${e.message}); usando respaldo FAQ.`);
      return this.fallback(ultimo);
    }
  }

  /** Bucle del agente con tool-calling. */
  private async runAgent(history: ChatTurn[], user?: { nombre?: string; username?: string; clienteId?: string; role?: string }): Promise<AssistantReply> {
    const ultimo = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
    const rol = user?.role as any;
    const ctx = { creadoPor: user?.username, nombre: user?.nombre, clienteId: user?.clienteId, rol };
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(ultimo, user) },
      // Historial corto: menos contexto = menos latencia. Las últimas 6 vueltas
      // bastan para mantener el hilo de una conversación de soporte.
      ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    ];

    let pago: AssistantReply['pago'] = null;
    const schemas = this.tools.schemas(rol);
    const { budgetMs, callTimeoutMs } = config.assistant;

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
      } catch (e: any) {
        // Timeout/fallo en una ronda: no abortamos, redactamos con lo que haya.
        this.logger.warn(`Ronda ${round} del agente falló (${e.message}); cierro con lo recopilado.`);
        break;
      }

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return {
          reply: (msg.content || '').trim() || 'Estoy aquí para ayudarte con tu servicio CICANET.',
          ai: true,
          acciones: this.accionesPara(ultimo + ' ' + (msg.content || '')),
          pago,
        };
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
      const reply = (final.content || '').trim();
      if (reply) {
        return { reply, ai: true, acciones: this.accionesPara(ultimo), pago };
      }
    } catch (e: any) {
      this.logger.warn(`Cierre del agente falló (${e.message}); respuesta acotada.`);
    }
    return {
      reply:
        'Estoy procesando bastante información para responderte bien y me tardé más de lo normal. ' +
        '¿Puedes precisar un poco la pregunta? También puedo conectarte con un asesor.',
      ai: true,
      acciones: this.accionesPara(ultimo),
      pago,
    };
  }

  /** Recorta un resultado de herramienta al tope configurado de caracteres. */
  private clip(s: string): string {
    const max = config.assistant.maxToolResultChars;
    return s.length > max ? `${s.slice(0, max)}… [resultado recortado]` : s;
  }

  /** System prompt anclado en la realidad de CICANET + FAQ recuperada (RAG-lite). */
  private systemPrompt(consulta: string, user?: { nombre?: string; role?: string }): string {
    const faqRelevante = retrieveFaq(consulta, 4)
      .map((f) => `• ${f.pregunta}\n  ${f.respuesta}`)
      .join('\n');
    const kb = faqRelevante || FAQ.slice(0, 4).map((f) => `• ${f.pregunta}\n  ${f.respuesta}`).join('\n');
    const rol = user?.role;
    const staff = rol === 'admin' || rol === 'operador';

    const bloqueStaff = staff
      ? [
          '',
          'MODO OPERADOR (el usuario es staff de CICANET, no un cliente):',
          '- Tienes herramientas internas: buscar_cliente, resumen_cliente, estado_red, buscar_ordenes, listar_tickets. Úsalas para responder con datos reales de operación (CRM/NOC).',
          rol === 'admin'
            ? '- Eres también un COPILOTO TÉCNICO del proyecto. Con explorar_proyecto, buscar_en_codigo y leer_archivo puedes consultar el código y la documentación (monorepo: apps/api NestJS, apps/web Next.js, apps/mobile Flutter, docs/). Úsalas para explicar la arquitectura, encontrar dónde está algo o proponer cambios concretos citando archivo y línea. Es SOLO LECTURA; los secretos vienen censurados, no los inventes ni intentes deducirlos.'
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
      '',
      'TU MISIÓN: resolver dudas de soporte y del servicio con precisión, en español de Colombia, tono cálido, claro y breve (frases cortas).',
      '',
      'REGLAS:',
      '- EFICIENCIA: si necesitas varias herramientas, invócalas TODAS en el mismo turno (se ejecutan en paralelo). No las pidas de una en una. En cuanto tengas los datos, responde; no hagas llamadas de más.',
      '- BREVEDAD: responde en pocas frases, lo justo. Nada de relleno ni repetir la pregunta.',
      '- Usa las herramientas para responder con datos reales (cobertura, pagos, contacto, planes). NO inventes datos técnicos, precios exactos, ni estados de cuenta: si una herramienta no te dio el dato, dilo.',
      '- NO inventes rutas, menús ni pasos de la app. Si el usuario pregunta CÓMO hacer algo en la app, PRIMERO usa la herramienta consultar_funciones_app y guíate SOLO por lo que devuelve. Nunca supongas que existe una pantalla, un botón o una función.',
      '- Distingue siempre la contraseña de la CUENTA (app) de la contraseña del WIFI (router). Si no está claro, pregunta cuál.',
      '- Cuando el cliente reporta una falla, primero usa diagnosticar_servicio (si está autenticado) y luego, si requiere seguimiento, ofrece crear un ticket con crear_ticket (confirmando antes).',
      '- Si no sabes algo o requiere intervención humana, ofrece contactar a un asesor con la herramienta contacto_asesor.',
      '- No reveles claves, tokens ni configuración interna.',
      '- Sé conciso: responde lo justo, sin relleno.',
      bloqueStaff,
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
