/**
 * Configuración central de la API CICANET.
 * Todos los valores tienen default para que la API corra sin .env en la demo.
 * En producción se sobrescriben por variables de entorno.
 */
import * as fs from 'fs';

/** Cuenta Cloudflare para el pool de rotación del asistente. */
export interface AssistantAccount {
  accountId: string;
  apiToken: string;
}

/**
 * Carga el pool de cuentas Cloudflare del asistente (mismo modelo que el
 * asistente de la web de access). Origen, por orden:
 *  1) ASSISTANT_ACCOUNTS = JSON inline `[{ "accountId|account_id", "apiToken|token" }]`
 *  2) ASSISTANT_ACCOUNTS_FILE = ruta a un JSON con ese formato (p. ej. cuentas.json)
 * Si no hay ninguno, el asistente usa la cuenta única (ASSISTANT_BASE_URL/KEY).
 */
function loadAssistantAccounts(): AssistantAccount[] {
  const norm = (arr: any[]): AssistantAccount[] =>
    (Array.isArray(arr) ? arr : [])
      .map((a) => ({ accountId: a.accountId ?? a.account_id, apiToken: a.apiToken ?? a.token }))
      .filter((a) => a.accountId && a.apiToken);
  try {
    if (process.env.ASSISTANT_ACCOUNTS) return norm(JSON.parse(process.env.ASSISTANT_ACCOUNTS));
    if (process.env.ASSISTANT_ACCOUNTS_FILE) {
      return norm(JSON.parse(fs.readFileSync(process.env.ASSISTANT_ACCOUNTS_FILE, 'utf8')));
    }
  } catch {
    /* JSON/archivo inválido → pool vacío (cae a cuenta única). */
  }
  return [];
}

export const config = {
  port: parseInt(process.env.API_PORT || '4000', 10),

  // Servicios de geodatos REALES (sin claves; respetan las políticas de uso).
  geo: {
    // Proveedor: 'google' (idéntico a Google Maps, requiere key), 'mapbox' o 'nominatim' (OSM).
    geocoder: (process.env.GEOCODER_PROVIDER || 'mapbox').toLowerCase(),
    mapboxToken: process.env.MAPBOX_TOKEN || '',
    googleKey: process.env.GOOGLE_MAPS_KEY || '',
    // Caja de sesgo (lat,lng SW | lat,lng NE) — zona de operación nororiente.
    bounds: process.env.GEO_BOUNDS || '6.26,-75.60|6.35,-75.52',
    // Sesgo de cercanía (lng,lat) — zona de operación de la ISP (nororiente: Popular/Santa Cruz/Robledo).
    proximity: process.env.GEO_PROXIMITY || '-75.5550,6.2990',
    // Geocodificación de direcciones (dirección -> coordenadas) vía OpenStreetMap.
    nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    // Geolocalización por IP (sin clave).
    ipApiUrl: process.env.IP_API_URL || 'http://ip-api.com/json',
    // Ortofoto oficial de Medellín (GeoMedellín, CC). El backend la cachea y
    // sirve por /api/tiles/medellin para NO depender del servidor municipal en
    // caliente (tras la 1ª descarga, cada tesela se sirve desde disco).
    // Template ArcGIS cacheado: tile/{z}/{y}/{x} (z=nivel, y=fila, x=columna).
    medellinTilesUrl:
      process.env.GEOMEDELLIN_TILES_URL ||
      'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosCiudad/IMAGEN_WEBM/MapServer/tile/{z}/{y}/{x}',
    // Ortofoto oficial de Bello (AMVA · IDE Metropolitana del Valle de Aburrá).
    // Mismo patrón que Medellín (proxied + cacheado en disco). Vacío por defecto:
    // si no se configura, el satélite de Google (que cubre Bello/Zamora/Santa Rita
    // a nivel de poste) hace de base. Para activar la ortofoto municipal define
    // GEOBELLO_TILES_URL con el template ArcGIS tile/{z}/{y}/{x} del servicio de
    // imagen del AMVA (portalidem.metropol.gov.co).
    belloTilesUrl: process.env.GEOBELLO_TILES_URL || '',
    // Ortofoto a COLOR del Valle de Aburrá (AMVA · SIM ArcGIS). Servicio dinámico
    // que reproyecta a Web Mercator al vuelo (export con bboxSR/imageSR=3857).
    // Cubre TODO el área metropolitana — incl. Bello/Zamora/Santa Rita — con la
    // ortofoto oficial. El backend la cachea por bbox (como el catastro). Es la
    // base nítida y SIN clave equivalente a la de GeoMedellín, pero para Bello.
    amvaOrtofotoUrl:
      process.env.AMVA_ORTOFOTO_URL ||
      'https://sim.metropol.gov.co/arcgis/rest/services/Ortofotos/Mosaico_Ortofotos_Color/MapServer/export',
    // Catastro vectorial del AMVA (predios/manzanas/construcciones) por municipio.
    // Servicios dinámicos ArcGIS (export). El backend los cachea por bbox.
    catastro: {
      bello:
        process.env.CATASTRO_BELLO_URL ||
        'https://portalidem.metropol.gov.co/server/rest/services/Bello_Catastro/MapServer/export',
      medellin:
        process.env.CATASTRO_MEDELLIN_URL ||
        'https://portalidem.metropol.gov.co/server/rest/services/DISTRITO_MEDELLIN_CATASTRO/MapServer/export',
    } as Record<string, string>,
    // Identificación requerida por la política de uso de Nominatim.
    userAgent:
      process.env.GEO_USER_AGENT ||
      'CICANET-ISP-Platform/1.0 (contacto: soporte@cicanet.co)',
    // Sesgo geográfico: área metropolitana de Medellín (lon/lat).
    // viewbox = lonMin,latMax,lonMax,latMin
    viewbox: process.env.GEO_VIEWBOX || '-75.72,6.40,-75.45,6.13',
    countryCodes: process.env.GEO_COUNTRY || 'co',
    // Carpeta donde se persisten las NAP creadas en runtime.
    dataDir: process.env.DATA_DIR || 'data',
  },

  // Orígenes permitidos para CORS (el panel web).
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3100')
    .split(',')
    .map((s) => s.trim()),

  // Origen efectivo para enableCors / Socket.IO: si CORS_ORIGINS incluye '*'
  // se refleja cualquier origen (necesario al exponer por un túnel como ngrok).
  get corsOrigin(): true | string[] {
    return this.corsOrigins.includes('*') ? true : this.corsOrigins;
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'cicanet-dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'cicanet-dev-refresh-secret-change-me',
    // 30 min: la sesión web se cierra tras 30 min de INACTIVIDAD (el front
    // refresca el token mientras el usuario trabaja; al quedar inactivo, expira).
    accessTtl: process.env.JWT_ACCESS_TTL || '30m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },

  // Credenciales del primer admin (semilla). En producción se crean en BD.
  seedAdmin: {
    username: process.env.SEED_ADMIN_USER || 'admin',
    password: process.env.SEED_ADMIN_PASS || 'cicanet2026',
  },

  // Demo público (igual patrón que VISIONYX Access): un visitante genera una
  // sesión efímera con credenciales propias y TTL; al expirar, el barredor
  // elimina el usuario. SOLO se activa con DEMO_MODE=true (en el despliegue de
  // demo); en el ISP real queda en false y el endpoint responde 403. NUNCA
  // habilitar en producción real (crearía cuentas staff sin auth).
  demo: {
    enabled: (process.env.DEMO_MODE || 'false').toLowerCase() === 'true',
    ttlMinutes: parseInt(process.env.DEMO_TTL_MINUTES || '60', 10),
    maxActiveSessions: parseInt(process.env.DEMO_MAX_ACTIVE_SESSIONS || '40', 10),
    sweepSeconds: parseInt(process.env.DEMO_SWEEP_SECONDS || '60', 10),
    // Rol del usuario demo (admin para mostrar toda la plataforma incl. la cabina).
    role: (process.env.DEMO_ROLE || 'admin').toLowerCase(),
    // URL pública de la app web a la que se envía al visitante a iniciar sesión.
    appUrl: (process.env.DEMO_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  },

  // Pasarela de pagos (Wompi — Colombia). Sandbox por defecto.
  // Llaves en https://comercios.wompi.co (test: pub_test_/prv_test_).
  wompi: {
    // 'sandbox' (pruebas) o 'production'.
    env: (process.env.WOMPI_ENV || 'sandbox').toLowerCase(),
    publicKey: process.env.WOMPI_PUBLIC_KEY || '',
    privateKey: process.env.WOMPI_PRIVATE_KEY || '',
    // Secreto de integridad (firma del checkout).
    integritySecret: process.env.WOMPI_INTEGRITY_SECRET || '',
    // Secreto de eventos (verificación del webhook).
    eventsSecret: process.env.WOMPI_EVENTS_SECRET || '',
    moneda: process.env.WOMPI_CURRENCY || 'COP',
    // A dónde vuelve el cliente tras pagar (deep link de la app o web).
    redirectUrl: process.env.WOMPI_REDIRECT_URL || 'https://cicanet.co/pago/resultado',
    // Datos de pago manual (Nequi/Bancolombia de la empresa) como alternativa.
    nequiEmpresa: process.env.CICANET_NEQUI || '',
    bancolombiaEmpresa: process.env.CICANET_BANCOLOMBIA || '',
  },

  // WhatsApp self-hosted vía Evolution API (gateway open-source). El teléfono de
  // la empresa se vincula escaneando un QR y queda como emisor/receptor. El
  // backend lo consume por la red interna de Docker (no expuesto a internet).
  evolution: {
    // Habilita la integración cuando WHATSAPP_PROVIDER=evolution.
    enabled: (process.env.WHATSAPP_PROVIDER || 'evolution').toLowerCase() === 'evolution',
    apiUrl: (process.env.EVOLUTION_API_URL || 'http://evolution-api:8080').replace(/\/$/, ''),
    apiKey: process.env.EVOLUTION_API_KEY || '',
    // Una instancia por operación (multi-tenant si algún día hay varias).
    instance: process.env.EVOLUTION_INSTANCE || 'cicanet',
    // URL que Evolution invoca al backend para entregar QR/estado/mensajes.
    // El secreto se añade en el PATH (Evolution preserva el path, no el query).
    webhookBase: process.env.EVOLUTION_WEBHOOK_URL || '',
    webhookSecret: process.env.NOTIFICATION_WEBHOOK_SECRET || '',
  },

  // Asistente virtual (chatbot de soporte con IA). Cliente LLM agnóstico
  // compatible con la API de OpenAI: sirve para Gemini, OpenAI, Groq, OpenRouter
  // u Ollama local cambiando solo estas variables. Si no hay apiKey, el asistente
  // responde con la base de conocimiento (FAQ determinista) sin alucinar.
  assistant: {
    // 'gemini' | 'openai' | 'groq' | 'openrouter' | 'ollama' | 'cloudflare' | 'custom'
    provider: (process.env.ASSISTANT_PROVIDER || 'gemini').toLowerCase(),
    apiKey: process.env.ASSISTANT_API_KEY || '',
    // Endpoint compatible-OpenAI. Default: Gemini (clave gratis en AI Studio).
    baseUrl: (
      process.env.ASSISTANT_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta/openai'
    ).replace(/\/$/, ''),
    model: process.env.ASSISTANT_MODEL || 'gemini-2.0-flash',
    // GLM (Cloudflare Workers AI) es "thinking": sin esto gasta tokens razonando
    // y deja `content` vacío. Lo desactivamos por defecto (igual que access).
    disableThinking: (process.env.ASSISTANT_DISABLE_THINKING || 'true') !== 'false',
    // Pool de cuentas Cloudflare para ROTACIÓN automática (mismo modelo y misma
    // robustez que el asistente "Vix" de access): al agotar la cuota/limite de
    // una cuenta (401/402/403/429) salta a la siguiente y reintenta.
    accounts: loadAssistantAccounts() as AssistantAccount[],
    // Plantilla de base URL de Workers AI por cuenta ({account_id} se sustituye).
    cloudflareBase:
      process.env.ASSISTANT_CF_BASE_TEMPLATE ||
      'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    // Tope de tokens de salida. En modelos locales el TIEMPO ≈ tokens_generados /
    // velocidad: con ~33 tok/s, 700 tokens son ~21s POR llamada. Respuestas de
    // soporte deben ser breves, así que limitamos fuerte (gran palanca de latencia).
    maxTokens: parseInt(process.env.ASSISTANT_MAX_TOKENS || '400', 10),
    temperature: parseFloat(process.env.ASSISTANT_TEMPERATURE || '0.3'),
    // Tiempo máximo por llamada al modelo (ms). Aborta si el modelo local se
    // cuelga, para no bloquear la petición HTTP.
    callTimeoutMs: parseInt(process.env.ASSISTANT_CALL_TIMEOUT_MS || '20000', 10),
    // Presupuesto total del agente (ms). Con el flujo plan→ejecutar→sintetizar
    // (2–3 llamadas) basta con ~35s; la petición SIEMPRE termina a tiempo y el
    // frontend nunca cae en "Tuve un problema para responder".
    budgetMs: parseInt(process.env.ASSISTANT_BUDGET_MS || '35000', 10),
    // Tope de caracteres del resultado de cada herramienta que se reinyecta al
    // modelo. Evita que leer archivos grandes infle el contexto (latencia).
    maxToolResultChars: parseInt(process.env.ASSISTANT_MAX_TOOL_RESULT_CHARS || '2500', 10),
  },

  // Raíz del código que el copiloto (rol admin) puede inspeccionar en solo
  // lectura. En Docker se monta el monorepo en /workspace:ro. Fuera de Docker
  // cae al cwd del proceso. El ProjectExplorerService bloquea secretos por código.
  codeRoot: process.env.CODE_ROOT || process.cwd(),

  // Microservicio de facturación electrónica DIAN (interno, no expuesto).
  einvoice: {
    enabled: (process.env.EINVOICE_ENABLED || 'true').toLowerCase() === 'true',
    url: (process.env.EINVOICE_URL || 'http://einvoice:8000').replace(/\/$/, ''),
    apiKey: process.env.EINVOICE_API_KEY || 'cicanet-einvoice-dev-key',
    // NIT de CICANET (emisor) y ambiente DIAN.
    nit: process.env.EINVOICE_NIT || '',
    ambiente: (process.env.EINVOICE_AMBIENTE || 'habilitacion').toLowerCase(),
  },
};

/** URLs base de la API de Wompi según el entorno. */
export const wompiUrls = {
  get api(): string {
    return config.wompi.env === 'production'
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';
  },
  checkout: 'https://checkout.wompi.co/p/',
};
