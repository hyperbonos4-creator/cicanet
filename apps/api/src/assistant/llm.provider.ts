import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

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

  get configured(): boolean {
    // Ollama local no requiere API key; cualquier otro proveedor sí.
    return !!config.assistant.apiKey || config.assistant.provider === 'ollama';
  }

  get model(): string {
    return config.assistant.model;
  }

  /**
   * Un turno de chat. Devuelve el mensaje del asistente (texto y/o tool_calls).
   * Lanza si no está configurado o si el proveedor falla.
   *
   * `opts.timeoutMs` aborta la llamada si el proveedor (p. ej. un modelo local
   * lento de Ollama) no responde a tiempo, para no bloquear la petición HTTP.
   */
  async chat(
    messages: ChatMessage[],
    tools?: ToolSchema[],
    opts?: { timeoutMs?: number; model?: string },
  ): Promise<AssistantMessage> {
    const { baseUrl, apiKey, model: defaultModel, maxTokens, temperature, callTimeoutMs } = config.assistant;
    const model = opts?.model || defaultModel;
    // Ollama local funciona sin API key; el resto de proveedores la exige.
    if (!apiKey && config.assistant.provider !== 'ollama') throw new Error('assistant_not_configured');

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const timeoutMs = Math.max(1000, opts?.timeoutMs ?? callTimeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          // Solo enviar Authorization si hay key (Ollama no la necesita).
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        this.logger.warn(`LLM timeout tras ${timeoutMs}ms`);
        throw new Error('assistant_timeout');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`LLM HTTP ${res.status}: ${detail.slice(0, 200)}`);
      throw new Error(`assistant_http_${res.status}`);
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
