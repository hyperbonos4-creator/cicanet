import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, type ChatMessage } from './llm.provider';
import { AgentToolsService } from './agent-tools.service';
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

const MAX_TOOL_ROUNDS = 4;

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

  async chat(history: ChatTurn[], user?: { nombre?: string }): Promise<AssistantReply> {
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
  private async runAgent(history: ChatTurn[], user?: { nombre?: string }): Promise<AssistantReply> {
    const ultimo = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(ultimo, user) },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    ];

    let pago: AssistantReply['pago'] = null;
    const schemas = this.tools.schemas();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const msg = await this.llm.chat(messages, schemas);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return {
          reply: (msg.content || '').trim() || 'Estoy aquí para ayudarte con tu servicio CICANET.',
          ai: true,
          acciones: this.accionesPara(ultimo + ' ' + (msg.content || '')),
          pago,
        };
      }

      // Registrar la intención de herramientas y ejecutarlas.
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await this.tools.execute(tc.function.name, args);
        if (tc.function.name === 'crear_link_pago' && (result as any)?.ok) {
          const r = result as any;
          pago = { url: r.url, referencia: r.referencia, monto: r.monto };
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Si agotó las rondas, una última respuesta sin herramientas.
    const final = await this.llm.chat(messages);
    return {
      reply: (final.content || '').trim() || 'Te ayudo con tu servicio CICANET.',
      ai: true,
      acciones: this.accionesPara(ultimo),
      pago,
    };
  }

  /** System prompt anclado en la realidad de CICANET + FAQ recuperada (RAG-lite). */
  private systemPrompt(consulta: string, user?: { nombre?: string }): string {
    const faqRelevante = retrieveFaq(consulta, 4)
      .map((f) => `• ${f.pregunta}\n  ${f.respuesta}`)
      .join('\n');
    const kb = faqRelevante || FAQ.slice(0, 4).map((f) => `• ${f.pregunta}\n  ${f.respuesta}`).join('\n');

    return [
      `Eres "Cica", el asistente virtual de ${EMPRESA.nombre}, un ${EMPRESA.rubro} que opera en ${EMPRESA.zona}.`,
      `Tecnología: ${EMPRESA.tecnologia}. Moneda: ${EMPRESA.moneda}. Horario de atención: ${EMPRESA.horario}.`,
      user?.nombre ? `Hablas con ${user.nombre}.` : '',
      '',
      'TU MISIÓN: resolver dudas de soporte y del servicio con precisión, en español de Colombia, tono cálido, claro y breve (frases cortas).',
      '',
      'REGLAS:',
      '- Usa las herramientas para responder con datos reales (cobertura, pagos, contacto). NO inventes datos técnicos, precios exactos, ni estados de cuenta.',
      '- Si no sabes algo o requiere intervención humana, ofrece contactar a un asesor con la herramienta contacto_asesor.',
      '- No reveles claves, tokens ni configuración interna.',
      '- Para problemas de conexión, guía pasos básicos (revisar luces del equipo, reiniciar, verificar mora) antes de escalar.',
      '- Sé conciso: responde lo justo, sin relleno.',
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
