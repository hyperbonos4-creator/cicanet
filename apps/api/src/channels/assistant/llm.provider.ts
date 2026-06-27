import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Solo en mensajes 'tool': id de la llamada que responde. */
  tool_call_id?: string;
  /** Solo en respuestas 'assistant' con herramientas. */
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Esquema de una herramienta (función) expuesta al modelo. */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AssistantMessage {
  content: string | null;
  tool_calls?: ToolCall[];
  /** Uso de tokens del proveedor (si lo reporta), para observabilidad. */
  usage?: { prompt: number; completion: number } | null;
}

/**
 * Cliente LLM agnóstico: habla la API de "chat completions" estilo OpenAI, que
 * implementan con el mismo formato OpenAI, Gemini (endpoint OpenAI-compat),
 * Qwen3 (DashScope/OpenRouter/Together/DeepInfra), Groq y Ollama local.
 * Cambiar de proveedor o de modelo = cambiar variables de entorno, no código.
 *
 * Soporta tool-calling (function calling) para el "agente operativo": el modelo
 * decide cuándo invocar herramientas reales de CICANET (cobertura, pagos, etc.).
 *
 * Confidencialidad: la apiKey viaja solo en el header Authorization; nunca se
 * loguea ni se devuelve al cliente.
 */
@Injectable()
export class LlmProvider {
  private readonly logger = new Logger('LlmProvider');
  /** Índice de la cuenta activa del pool (persistente en el proceso). */
  private accountIdx = 0;
  /** Códigos HTTP que justifican rotar de cuenta. */
  private readonly rotatable = new Set([401, 402, 403, 429]);

  get configured(): boolean {
    // Hay con qué responder: pool de cuentas, cuenta única, u Ollama local.
    return (
      config.assistant.accounts.length > 0 ||
      !!config.assistant.apiKey ||
      config.assistant.provider === 'ollama'
    );
  }

  get model(): string {
    return config.assistant.model;
  }

  /**
   * Un turno de chat. Devuelve el mensaje del asistente (texto y/o tool_calls).
   * Si hay un pool de cuentas Cloudflare configurado, ROTA automáticamente ante
   * cuota/límite/auth (401/402/403/429) o timeout — igual que el asistente de
   * access. Si no, usa la cuenta única (Gemini/OpenAI/Ollama…).
   */
  async chat(
    messages: ChatMessage[],
    tools?: ToolSchema[],
    opts?: { timeoutMs?: number; model?: string },
  ): Promise<AssistantMessage> {
    const { maxTokens, temperature, callTimeoutMs, disableThinking } = config.assistant;
    const model = opts?.model || config.assistant.model;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };
    // GLM (Cloudflare) necesita esto para responder en `content` y no "pensar".
    if (disableThinking) body.chat_template_kwargs = { enable_thinking: false };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const timeoutMs = Math.max(1000, opts?.timeoutMs ?? callTimeoutMs);
    const pool = config.assistant.accounts;

    // ── Modo pool: rota entre cuentas Cloudflare (mismo modelo que access) ──
    if (pool.length) {
      let lastErr: any;
      for (let attempt = 0; attempt < pool.length; attempt++) {
        const acc = pool[this.accountIdx % pool.length];
        const baseUrl = config.assistant.cloudflareBase
          .replace('{account_id}', acc.accountId)
          .replace(/\/+$/, '');
        try {
          return await this.doCall(baseUrl, acc.apiToken, body, timeoutMs);
        } catch (e: any) {
          lastErr = e;
          if (!this.isRotatable(e)) throw e;
          this.logger.warn(
            `Asistente: cuenta ${acc.accountId} no disponible (${e?.status ?? e?.message}); rotando…`,
          );
          this.accountIdx = (this.accountIdx + 1) % pool.length;
        }
      }
      throw lastErr ?? new Error('assistant_all_accounts_exhausted');
    }

    // ── Cuenta única (Gemini/OpenAI/Groq/Ollama…) ──
    if (!config.assistant.apiKey && config.assistant.provider !== 'ollama') {
      throw new Error('assistant_not_configured');
    }
    return this.doCall(config.assistant.baseUrl, config.assistant.apiKey, body, timeoutMs);
  }

  /** ¿El error justifica rotar de cuenta? (límite/cuota/auth o timeout). */
  private isRotatable(e: any): boolean {
    if (e?.rotatable === true) return true;
    return typeof e?.status === 'number' && this.rotatable.has(e.status);
  }

  /** Llamada cruda a un endpoint OpenAI-compatible; marca status/timeout. */
  private async doCall(
    baseUrl: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<AssistantMessage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        this.logger.warn(`LLM timeout tras ${timeoutMs}ms`);
        const err: any = new Error('assistant_timeout');
        err.rotatable = true; // una cuenta colgada → probar la siguiente
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`LLM HTTP ${res.status}: ${detail.slice(0, 200)}`);
      const err: any = new Error(`assistant_http_${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    const usage = data?.usage
      ? { prompt: Number(data.usage.prompt_tokens ?? 0), completion: Number(data.usage.completion_tokens ?? 0) }
      : null;
    return {
      content: stripThinking(msg?.content),
      tool_calls: msg?.tool_calls,
      usage,
    };
  }
}

/**
 * Quita el bloque de razonamiento de modelos "thinking" (Qwen3, DeepSeek-R1, etc.)
 * para que no se filtre al cliente. Cubre varias variantes de etiquetas.
 */
function stripThinking(content: string | null | undefined): string | null {
  if (content == null) return null;
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    // Bloque "reasoning_content" embebido al inicio (algunos modelos locales).
    .replace(/^\s*reasoning[_\s]?content\s*[:=][\s\S]*?(?=\n\n)/i, '')
    // Etiqueta de apertura huérfana (si el modelo se cortó sin cerrarla).
    .replace(/<\/?(?:think|thinking|reasoning|reflection|analysis)>/gi, '')
    .trim();
}
