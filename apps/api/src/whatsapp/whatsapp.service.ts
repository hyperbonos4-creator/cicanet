import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

/** Estado de la sesión de WhatsApp (para el panel de vinculación). */
export type WaState = 'idle' | 'connecting' | 'qr' | 'open' | 'close';

export interface WaStatus {
  state: WaState;
  /** QR (data URL PNG) para vincular el WhatsApp emisor; null si ya está abierto. */
  qrDataUrl: string | null;
  /** Número vinculado (E.164, solo dígitos) cuando el estado es 'open'. */
  numero: string | null;
}

/** Resumen de una conversación con un cliente (espejo de la bandeja). */
export interface WaChat {
  jid: string; // remoteJid de WhatsApp (ej. 573001234567@s.whatsapp.net)
  numero: string; // solo dígitos
  nombre: string | null;
  ultimoMensaje: string;
  /** true si lo envió el cliente (entrante), false si lo envió la empresa. */
  entrante: boolean;
  ts: number; // epoch ms del último mensaje
  noLeidos: number;
}

/**
 * Integración con **Evolution API** (gateway WhatsApp self-hosted). La empresa
 * vincula su teléfono escaneando un QR; a partir de ahí ese número es el emisor/
 * receptor de los chats con los clientes.
 *
 * Contrato Evolution v2:
 * - `POST /instance/create` { instanceName, qrcode, integration, webhook }.
 * - `POST /webhook/set/{instance}` { webhook }.
 * - `GET  /instance/connect/{instance}` → { base64 } (QR, fallback).
 * - `GET  /instance/connectionState/{instance}` → { instance: { state } }.
 * - `DELETE /instance/logout/{instance}` → desvincula.
 * - Eventos por webhook: QRCODE_UPDATED, CONNECTION_UPDATE, MESSAGES_UPSERT.
 *
 * La QR/estado/chats se cachean en memoria (proceso único). La sesión persiste en
 * Evolution (sobrevive reinicios) y los chats reales viven en el teléfono.
 * La apikey viaja solo en el header `apikey`; nunca se loguea ni se devuelve.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsappService');

  private cachedStatus: WaStatus = { state: 'idle', qrDataUrl: null, numero: null };
  private chats = new Map<string, WaChat>();
  private instanceEnsured = false;

  private get cfg() {
    return config.evolution;
  }

  /** URL del webhook con el secreto en el PATH (Evolution preserva el path). */
  private get webhookUrl(): string {
    const { webhookBase, webhookSecret } = this.cfg;
    return webhookBase && webhookSecret
      ? `${webhookBase}/${encodeURIComponent(webhookSecret)}`
      : '';
  }

  // ---------------------------------------------------------------------------
  //  API pública (controller)
  // ---------------------------------------------------------------------------

  /** Estado + QR de vinculación para el panel admin. */
  async getStatus(): Promise<WaStatus> {
    if (!this.cfg.enabled || !this.cfg.apiKey) {
      return { state: 'idle', qrDataUrl: null, numero: null };
    }
    // El webhook ya pobló QR/estado: es la fuente fiable en Evolution v2.
    if (this.cachedStatus.state === 'open' || this.cachedStatus.qrDataUrl) {
      return this.cachedStatus;
    }
    // Fallback REST: estado de conexión.
    let state: WaState = 'connecting';
    try {
      const res = await this.call(`/instance/connectionState/${this.inst()}`, 'GET');
      const raw = this.readState(res.body);
      state = raw === 'open' ? 'open' : raw === 'close' ? 'close' : 'connecting';
    } catch {
      state = 'close';
    }
    if (state === 'open') {
      const numero = this.cachedStatus.numero || (await this.fetchOwnerNumber());
      this.cachedStatus = { state, qrDataUrl: null, numero };
      return this.cachedStatus;
    }
    const qr = await this.fetchQr();
    return { state: qr ? 'qr' : state, qrDataUrl: qr, numero: null };
  }

  /** Inicia/reanuda la vinculación: crea la instancia + webhook y dispara el QR. */
  async connect(): Promise<WaStatus> {
    await this.ensureInstance();
    await this.fetchQr();
    return this.getStatus();
  }

  /** Desvincula el teléfono (cierra la sesión en Evolution). */
  async logout(): Promise<{ ok: boolean }> {
    try {
      await this.call(`/instance/logout/${this.inst()}`, 'DELETE');
    } catch {
      // best-effort
    }
    this.cachedStatus = { state: 'close', qrDataUrl: null, numero: null };
    this.instanceEnsured = false;
    return { ok: true };
  }

  /** Lista de chats con clientes (más reciente primero). */
  listChats(): WaChat[] {
    return [...this.chats.values()].sort((a, b) => b.ts - a.ts);
  }

  /**
   * Datos de contacto que usa la app del cliente al tocar "Soporte": el número
   * vinculado por QR. Si no hay vínculo, el controller cae al número manual.
   */
  /**
   * Vinculación por CÓDIGO (alternativa al QR). Pide a Evolution un "pairing code"
   * para un número; el usuario lo escribe en WhatsApp → Dispositivos vinculados →
   * Vincular con número de teléfono. Útil por túnel/móvil donde escanear el QR no
   * es práctico (o el QR expira por latencia).
   */
  async pairWithNumber(numero: string): Promise<{ pairingCode: string | null; numero: string }> {
    const limpio = digits(numero);
    if (limpio.length < 10) return { pairingCode: null, numero: limpio };
    const e164 = limpio.length === 10 ? `57${limpio}` : limpio;
    if (!this.cfg.apiKey) return { pairingCode: null, numero: e164 };
    await this.ensureInstance();
    try {
      const res = await this.call(`/instance/connect/${this.inst()}?number=${e164}`, 'GET');
      const body: any = res.body;
      // Solo el campo dedicado `pairingCode` es válido. `code`/`base64` traen el
      // contenido del QR (no sirve como código para "Vincular con número").
      const raw = typeof body?.pairingCode === 'string' ? body.pairingCode.trim() : '';
      const valido = raw.length >= 6 && raw.length <= 12 && !raw.includes('@') && /^[A-Z0-9-]+$/i.test(raw);
      return { pairingCode: valido ? raw : null, numero: e164 };
    } catch {
      return { pairingCode: null, numero: e164 };
    }
  }

  contact(mensaje: string): { habilitado: boolean; numero: string; url: string | null } {
    const numero = this.cachedStatus.state === 'open' ? this.cachedStatus.numero : null;
    if (!numero) return { habilitado: false, numero: '', url: null };
    return {
      habilitado: true,
      numero,
      url: `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`,
    };
  }

  // ---------------------------------------------------------------------------
  //  Webhook (eventos de Evolution)
  // ---------------------------------------------------------------------------

  /** Procesa un evento entrante de Evolution. Best-effort: nunca lanza. */
  async handleEvent(payload: any): Promise<void> {
    if (!payload || typeof payload !== 'object') return;
    const event = String(payload.event ?? '').toLowerCase().replace(/_/g, '.');
    const data = payload.data ?? {};
    try {
      if (event === 'qrcode.updated') {
        const base64 =
          (typeof data?.qrcode?.base64 === 'string' && data.qrcode.base64) ||
          (typeof data?.base64 === 'string' && data.base64) ||
          null;
        if (base64) this.cachedStatus = { state: 'qr', qrDataUrl: base64, numero: null };
      } else if (event === 'connection.update') {
        const state = typeof data?.state === 'string' ? data.state : '';
        if (state === 'open') {
          const wuid: string = data?.wuid ?? data?.me ?? '';
          this.cachedStatus = {
            state: 'open',
            qrDataUrl: null,
            numero: digits(wuid) || this.cachedStatus.numero,
          };
          this.logger.log('WhatsApp vinculado (sesión abierta).');
        } else if (state === 'close') {
          this.cachedStatus = { state: 'close', qrDataUrl: null, numero: null };
        }
      } else if (event === 'messages.upsert') {
        this.ingestMessages(data);
      }
    } catch (e: any) {
      this.logger.warn(`handleEvent: ${e.message}`);
    }
  }

  /** Extrae y registra mensajes entrantes/salientes para la bandeja del panel. */
  private ingestMessages(data: any) {
    const arr = Array.isArray(data) ? data : data?.messages ?? [data];
    for (const m of arr) {
      const key = m?.key;
      if (!key?.remoteJid) continue;
      const jid: string = key.remoteJid;
      // Ignora grupos y estados/broadcast.
      if (jid.endsWith('@g.us') || jid.includes('broadcast') || jid.includes('status@')) continue;
      const entrante = key.fromMe !== true;
      const texto = extractText(m?.message) || (entrante ? '(mensaje)' : '(enviado)');
      const ts = (Number(m?.messageTimestamp) || Date.now() / 1000) * 1000;
      const prev = this.chats.get(jid);
      this.chats.set(jid, {
        jid,
        numero: digits(jid),
        nombre: m?.pushName || prev?.nombre || null,
        ultimoMensaje: texto.slice(0, 200),
        entrante,
        ts,
        noLeidos: entrante ? (prev?.noLeidos ?? 0) + 1 : prev?.noLeidos ?? 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  //  Evolution low-level
  // ---------------------------------------------------------------------------

  private inst(): string {
    return encodeURIComponent(this.cfg.instance);
  }

  private async ensureInstance(): Promise<void> {
    if (!this.cfg.apiKey) return;
    if (!this.instanceEnsured) {
      try {
        await this.call('/instance/create', 'POST', {
          instanceName: this.cfg.instance,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          // Webhook en el create para no perder el primer QR (carrera).
          ...(this.webhookUrl ? { webhook: this.webhookConfig() } : {}),
        });
      } catch {
        // Ya existe o el gateway está iniciando.
      }
      this.instanceEnsured = true;
    }
    await this.setWebhook();
  }

  private webhookConfig(): Record<string, unknown> {
    return {
      enabled: true,
      url: this.webhookUrl,
      byEvents: false,
      base64: true,
      events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
    };
  }

  private async setWebhook(): Promise<void> {
    if (!this.cfg.apiKey || !this.webhookUrl) return;
    try {
      await this.call(`/webhook/set/${this.inst()}`, 'POST', {
        webhook: this.webhookConfig(),
      });
    } catch {
      // best-effort
    }
  }

  private async fetchQr(): Promise<string | null> {
    if (!this.cfg.apiKey) return null;
    try {
      const res = await this.call(`/instance/connect/${this.inst()}`, 'GET');
      const body: any = res.body;
      const base64 = body?.base64 ?? body?.qrcode?.base64;
      if (typeof base64 === 'string') {
        this.cachedStatus = { state: 'qr', qrDataUrl: base64, numero: null };
        return base64;
      }
      return null;
    } catch {
      return null;
    }
  }

  private readState(body: any): string | null {
    const s = body?.instance?.state ?? body?.state;
    return typeof s === 'string' ? s : null;
  }

  /** Obtiene el número (JID) del WhatsApp vinculado vía REST (fallback al webhook). */
  private async fetchOwnerNumber(): Promise<string | null> {
    try {
      const res = await this.call(
        `/instance/fetchInstances?instanceName=${this.inst()}`,
        'GET',
      );
      const body: any = res.body;
      const item = Array.isArray(body) ? body[0] : body;
      const raw =
        item?.ownerJid ??
        item?.owner ??
        item?.instance?.owner ??
        item?.instance?.ownerJid ??
        '';
      const d = digits(raw);
      return d || null;
    } catch {
      return null;
    }
  }

  /** Llamada HTTP a Evolution con la apikey en header (fetch global de Node 20). */
  // ---------------------------------------------------------------------------
  //  Envío saliente (usado por dunning/cobranza)
  // ---------------------------------------------------------------------------

  /**
   * Envía un mensaje de texto por WhatsApp vía Evolution. Best-effort: si la
   * instancia no está conectada o falla, devuelve ok:false (no lanza). Normaliza
   * el número a formato internacional Colombia (57) si llega a 10 dígitos.
   */
  async sendText(numero: string, mensaje: string): Promise<{ ok: boolean; numero: string; error?: string }> {
    const limpio = digits(numero);
    if (limpio.length < 10) return { ok: false, numero: limpio, error: 'numero_invalido' };
    const e164 = limpio.length === 10 ? `57${limpio}` : limpio;
    if (this.cachedStatus.state !== 'open') return { ok: false, numero: e164, error: 'whatsapp_no_conectado' };
    try {
      const res = await this.call(`/message/sendText/${this.inst()}`, 'POST', { number: e164, text: mensaje });
      return { ok: res.ok, numero: e164, error: res.ok ? undefined : `evolution_${res.status}` };
    } catch (e: any) {
      return { ok: false, numero: e164, error: e.message };
    }
  }

  private async call(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await fetch(`${this.cfg.apiUrl}${path}`, {
      method,
      headers: {
        apikey: this.cfg.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
}

/** Deja solo dígitos (de un JID o número con sufijos). */
function digits(v: string): string {
  return String(v || '').split('@')[0].replace(/[^\d]/g, '');
}

/** Extrae el texto legible de un objeto `message` de Baileys/Evolution. */
function extractText(message: any): string | null {
  if (!message || typeof message !== 'object') return null;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    (message.imageMessage ? '📷 Imagen' : null) ||
    (message.audioMessage ? '🎤 Audio' : null) ||
    (message.documentMessage ? '📄 Documento' : null) ||
    null
  );
}
