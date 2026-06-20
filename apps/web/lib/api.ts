/**
 * Cliente de la API CICANET + manejo de sesión.
 * El access token se guarda en cookie (para que el middleware proteja rutas)
 * y en localStorage (para las llamadas fetch y el socket).
 *
 * Nota de seguridad: en producción el token debe entregarse en una cookie
 * httpOnly emitida por la API. Aquí se simplifica para la demo.
 */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000/realtime";

const TOKEN_KEY = "cica_token";
const REFRESH_KEY = "cica_refresh";
const USER_KEY = "cica_user";

export type SessionUser = {
  id: string;
  username: string;
  nombre: string;
  email: string;
  role: "admin" | "operador" | "tecnico" | "contador";
};

// ---- almacenamiento ----
export function setSession(accessToken: string, refreshToken: string, user: SessionUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // cookie para el middleware (1 día). Secure cuando se sirve por HTTPS (ngrok),
  // para que el navegador la acepte/envíe de forma fiable.
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${TOKEN_KEY}=${accessToken}; path=/; max-age=86400; samesite=lax${secure}`;
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

// ---- llamadas ----
export async function login(username: string, password: string) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Usuario o contraseña incorrectos");
  }
  const data = await res.json();
  setSession(data.accessToken, data.refreshToken, data.user);
  return data.user as SessionUser;
}

async function authFetch(path: string, init: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.message || `Error ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(" · ") : msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type CoverageResult = {
  cobertura: boolean;
  estado: string;
  tecnologia?: string;
  area?: string;
  mensaje: string;
  napCercano?: { id: string; nombre: string; metros: number; libres: number } | null;
  lng: number;
  lat: number;
};

export function fetchBundle() {
  return authFetch("/network/bundle");
}

export function checkCoverage(lng: number, lat: number): Promise<CoverageResult> {
  return authFetch("/network/coverage/check", {
    method: "POST",
    body: JSON.stringify({ lng, lat }),
  });
}

// ---- Geocodificación e IP-geolocalización (datos reales OSM / ip-api) ----
export type GeocodeCandidate = {
  displayName: string;
  lat: number;
  lng: number;
  tipo: string;
  importancia: number;
  dentroDelBarrio: boolean;
};

export type IpLocation = {
  lat: number;
  lng: number;
  ciudad?: string;
  region?: string;
  pais?: string;
  ip?: string;
  fuente: "ip-api" | "fallback";
  dentroDelBarrio: boolean;
};

export function ipLocate(): Promise<IpLocation> {
  return authFetch("/geo/ip");
}

export function geocode(q: string): Promise<GeocodeCandidate[]> {
  return authFetch("/geo/geocode", {
    method: "POST",
    body: JSON.stringify({ q }),
  });
}

export function reverseGeocode(lat: number, lng: number): Promise<{ direccion: string | null }> {
  return authFetch("/geo/reverse", {
    method: "POST",
    body: JSON.stringify({ lat, lng }),
  });
}

// ---- Street View (Google, gateado por disponibilidad) ----
export type StreetViewMeta = {
  disponible: boolean;
  panoId: string | null;
  lat: number;
  lng: number;
  fecha: string | null;
  fuente: string | null;
};

/** ¿Hay panorámica de Street View cerca del punto? (metadata gratuita). */
export function streetViewMeta(lat: number, lng: number): Promise<StreetViewMeta> {
  return authFetch(`/geo/streetview?lat=${lat}&lng=${lng}`);
}

/** URL de imagen Street View servida por el proxy (clave en el servidor). */
export function streetViewImageUrl(p: {
  lat: number; lng: number; heading?: number; pitch?: number; fov?: number;
}): string {
  const qs = new URLSearchParams({
    lat: String(p.lat),
    lng: String(p.lng),
    heading: String(p.heading ?? 0),
    pitch: String(p.pitch ?? 0),
    fov: String(p.fov ?? 90),
  }).toString();
  return `${MEDIA_ORIGIN}/api/tiles/streetview?${qs}`;
}

// ---- Infraestructura: NAPs ----
export type NapRecord = {
  id: string;
  nombre: string;
  tipo: "NAP" | "CTO";
  lng: number;
  lat: number;
  puertos_total: number;
  puertos_usados: number;
  direccion?: string;
  creadoPor?: string;
  creadoEn: string;
};

export type CreateNapInput = {
  nombre?: string;
  tipo?: "NAP" | "CTO";
  lng?: number;
  lat?: number;
  direccion?: string;
  puertos_total?: number;
  puertos_usados?: number;
};

export function listNaps(): Promise<NapRecord[]> {
  return authFetch("/network/naps");
}

export function createNap(input: CreateNapInput): Promise<NapRecord> {
  return authFetch("/network/naps", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteNap(id: string): Promise<{ id: string }> {
  return authFetch(`/network/naps/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---- Zonas de cobertura dibujadas ----
export type ZoneRecord = {
  id: string;
  nombre: string;
  anillo: number[][];
  creadoPor?: string;
  creadoEn: string;
};

export function listZones(): Promise<ZoneRecord[]> {
  return authFetch("/network/zones");
}

export function createZone(nombre: string, puntos: number[][]): Promise<ZoneRecord> {
  return authFetch("/network/zones", {
    method: "POST",
    body: JSON.stringify({ nombre, puntos }),
  });
}

export function deleteZone(id: string): Promise<{ id: string }> {
  return authFetch(`/network/zones/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Gemelo Digital de la Red (módulo infra) ----
export type FeatureColl = { type: "FeatureCollection"; features: any[] };

export type InfraBundle = {
  assets: FeatureColl;
  fiber: FeatureColl;
  sites: FeatureColl;
  stats: { activos: number; fibras: number; metrosFibra: number; sitios: number };
};

export type InfraAsset = {
  id: string;
  tipo: string;
  nombre: string;
  direccion?: string;
  lng: number;
  lat: number;
  estado: string;
  atributos?: Record<string, any>;
  creadoEn: string;
};

export type InfraFiber = {
  id: string;
  nombre?: string;
  longitud: number;
  hilos?: number;
  tipoFibra?: string;
  origen: { lng: number; lat: number };
  destino: { lng: number; lat: number };
  origenDireccion?: string;
  destinoDireccion?: string;
  creadoEn: string;
};

export function infraBundle(): Promise<InfraBundle> {
  return authFetch("/infra/bundle");
}
export function listInfraAssets(): Promise<InfraAsset[]> {
  return authFetch("/infra/assets");
}
export function listInfraFiber(): Promise<InfraFiber[]> {
  return authFetch("/infra/fiber");
}
export function createInfraAsset(input: {
  tipo: string;
  nombre?: string;
  direccion?: string;
  lng?: number;
  lat?: number;
  marca?: string;
  modelo?: string;
  serie?: string;
  puertosTotal?: number;
  puertosUsados?: number;
  planMensual?: number;
  atributos?: Record<string, any>;
}): Promise<InfraAsset> {
  return authFetch("/infra/assets", { method: "POST", body: JSON.stringify(input) });
}
export function deleteInfraAsset(id: string): Promise<{ id: string }> {
  return authFetch(`/infra/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function createInfraFiber(input: {
  nombre?: string;
  tipoFibra?: "monomodo" | "multimodo";
  hilos?: number;
  origenId?: string;
  destinoId?: string;
  origenDireccion?: string;
  destinoDireccion?: string;
  origen?: { lng: number; lat: number };
  destino?: { lng: number; lat: number };
}): Promise<InfraFiber> {
  return authFetch("/infra/fiber", { method: "POST", body: JSON.stringify(input) });
}
export function deleteInfraFiber(id: string): Promise<{ id: string }> {
  return authFetch(`/infra/fiber/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setAssetParent(id: string, parentId: string | null): Promise<InfraAsset> {
  return authFetch(`/infra/assets/${encodeURIComponent(id)}/parent`, {
    method: "PUT",
    body: JSON.stringify({ parentId }),
  });
}
export function getAssetDetail(id: string): Promise<any> {
  return authFetch(`/infra/assets/${encodeURIComponent(id)}`);
}

// ---- Evidencia fotográfica georreferenciada (vista de calle propia) ----
export type PhotoCategory = "vista_general" | "frontal" | "placa_serial" | "instalacion";

export type AssetPhoto = {
  id: string;
  categoria: PhotoCategory;
  url: string;
  subidoEn: string;
  autor?: string;
};

/** Origen de la API sin el sufijo /api, para componer URLs de /uploads. */
export const MEDIA_ORIGIN = API_URL.replace(/\/api\/?$/, "");

/** URL absoluta y servible de una foto guardada (`/uploads/...`). */
export function mediaUrl(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${MEDIA_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Sube una foto de evidencia a un activo (multipart). Devuelve la foto creada. */
export async function uploadAssetPhoto(
  assetId: string,
  file: File,
  categoria: PhotoCategory,
): Promise<{ foto: AssetPhoto }> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  form.append("categoria", categoria);
  const res = await fetch(`${API_URL}/infra/assets/${encodeURIComponent(assetId)}/photos`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form, // sin Content-Type: el navegador fija el boundary del multipart.
  });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.message || `Error ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(" · ") : msg);
  }
  return res.json();
}

export function deleteAssetPhoto(assetId: string, photoId: string): Promise<{ id: string }> {
  return authFetch(
    `/infra/assets/${encodeURIComponent(assetId)}/photos/${encodeURIComponent(photoId)}`,
    { method: "DELETE" },
  );
}

// ---- Modo construcción / simulador de venta ----
export type ConstructionResult = {
  punto: { lng: number; lat: number };
  resultado: "instalable" | "no_instalable";
  causa: "sin_puertos" | "fuera_de_alcance" | null;
  distanciaTendido: number | null;
  puertosLibres: number | null;
  costoEstimado: number | null;
  tiempoEstimadoDias: number | null;
  nap: { id: string; nombre: string; lng: number; lat: number; distanciaMax: number } | null;
};

export function evaluateConstruction(lng: number, lat: number): Promise<ConstructionResult> {
  return authFetch("/infra/construction/evaluate", {
    method: "POST",
    body: JSON.stringify({ lng, lat }),
  });
}

// ---- Motor de asignación de NAP (sugerencia al dar de alta) ----
export type NapSuggestion = {
  id: string;
  nombre: string;
  lng: number;
  lat: number;
  distancia: number;
  distanciaMax: number;
  puertosTotal: number | null;
  puertosUsados: number | null;
  puertosLibres: number;
  semaforo: "verde" | "amarillo" | "rojo" | null;
  viable: boolean;
  causa: "sin_puertos" | "fuera_de_alcance" | null;
};

export function suggestNaps(lng: number, lat: number): Promise<NapSuggestion[]> {
  return authFetch(`/infra/suggest-naps?lng=${lng}&lat=${lat}`);
}

// ---- Suscriptores (clientes del ISP) ----
export type TipoDocumento = "CC" | "CE" | "NIT" | "PAS";
export type TipoClienteISP = "residencial" | "empresarial";
export type Tecnologia = "FTTH" | "Inalambrico" | "HFC";
export type EstadoServicio = "instalacion_pendiente" | "activo" | "suspendido" | "cortado";
export type EstadoCliente = "activo" | "suspendido" | "retirado" | "moroso";
export type CicloFacturacion = "mensual" | "bimestral" | "anticipado";
export type MetodoPago = "efectivo" | "transferencia" | "tarjeta" | "PSE";

export type Cliente = {
  id: string;
  // identificación / contacto
  tipoDocumento: TipoDocumento;
  documento: string;
  nombre: string;
  tipoCliente: TipoClienteISP;
  email?: string;
  telefonoMovil?: string;
  telefonoFijo?: string;
  // dirección de instalación
  direccion: string;
  barrio?: string;
  comuna?: string;
  ciudad: string;
  departamento?: string;
  estrato?: number;
  lat?: number;
  lng?: number;
  referencias?: string;
  // plan / técnico
  plan: string;
  velocidadBajada?: number;
  velocidadSubida?: number;
  tecnologia: Tecnologia;
  napId?: string;
  puerto?: number;
  onuSerial?: string;
  ip?: string;
  vlan?: number;
  fechaInstalacion?: string;
  estadoServicio: EstadoServicio;
  // facturación / contrato
  cicloFacturacion?: CicloFacturacion;
  diaCorte?: number;
  metodoPago?: MetodoPago;
  tarifa?: number;
  saldo?: number;
  numeroContrato?: string;
  fechaInicioContrato?: string;
  fechaFinContrato?: string;
  // meta
  estado: EstadoCliente;
  notas?: string;
  creadoPor?: string;
  creadoEn: string;
  actualizadoEn?: string;
};

export type ClienteInput = Partial<Omit<Cliente, "id" | "creadoEn" | "creadoPor" | "actualizadoEn">>;

export type ClienteStats = {
  total: number;
  porEstado: Record<EstadoCliente, number>;
  porServicio: Record<EstadoServicio, number>;
  porTecnologia: Record<Tecnologia, number>;
  ingresoMensual: number;
  saldoPendiente: number;
};

export type ClienteFilters = {
  q?: string;
  estado?: string;
  estadoServicio?: string;
  tecnologia?: string;
  barrio?: string;
};

export function listClientes(filters: ClienteFilters = {}): Promise<Cliente[]> {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v != null && v !== "") as [string, string][],
  ).toString();
  return authFetch(`/clientes${qs ? `?${qs}` : ""}`);
}
export function getCliente(id: string): Promise<Cliente> {
  return authFetch(`/clientes/${encodeURIComponent(id)}`);
}
export function clientesStats(): Promise<ClienteStats> {
  return authFetch("/clientes/stats");
}
export function createCliente(input: ClienteInput): Promise<Cliente> {
  return authFetch("/clientes", { method: "POST", body: JSON.stringify(input) });
}
export function updateCliente(id: string, input: ClienteInput): Promise<Cliente> {
  return authFetch(`/clientes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}
export function deleteCliente(id: string): Promise<{ id: string }> {
  return authFetch(`/clientes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Customer 360 (vista integral del suscriptor) ----
export type Cliente360 = {
  cliente: {
    id: string; nombre: string; tipoDocumento: string; documento: string;
    tipoCliente: string; email: string | null; telefonoMovil: string | null;
    telefonoFijo: string | null; estado: string; creadoEn: string;
  };
  ubicacion: {
    direccion: string; barrio: string | null; comuna: string | null; ciudad: string;
    estrato: number | null; lat: number | null; lng: number | null; referencias: string | null;
  };
  servicio: {
    plan: string; estadoServicio: string; estadoCliente: string; tecnologia: string;
    velocidadBajada: number | null; velocidadSubida: number | null; tarifa: number; saldo: number;
    diaCorte: number | null; cicloFacturacion: string | null; metodoPago: string | null;
    numeroContrato: string | null; fechaInstalacion: string | null;
    ip: string | null; vlan: number | null; onuSerial: string | null; puerto: number | null; napId: string | null;
  };
  facturacion: {
    saldo: number; vencidas: number; pendientes: number;
    ultimoPago: { monto: number; fecha: string | null; metodo: string } | null;
    proximoVencimiento: string | null;
    facturas: { id: string; periodo: string; total: number; estado: string; fechaEmision: string | null; fechaVencimiento: string | null; pagada: boolean }[];
  };
  tickets: { id: string; codigo: string; asunto: string; categoria: string; estado: string; creadoEn: string }[];
  ticketsAbiertos: number;
  red: {
    encontrado: boolean;
    onu: { onuSerial: string | null; puerto: number | null; ip: string | null; vlan: number | null };
    nap: { id: string; nombre: string; tipo: string; direccion: string | null; capacidad: { total: number; usados: number; libres: number; semaforo: string } | null; impacto: { clientesDependientes: number; napsDependientes: number; ingresosMensuales: number }; fotos?: AssetPhoto[] } | null;
    cadena: { id: string; nombre: string; tipo: string }[];
    vecinos?: { total: number; conFalla: number; conTicketAbierto: number };
  };
  alertas: { tipo: string; nivel: "alta" | "media" | "info"; mensaje: string }[];
};

export function getCliente360(id: string): Promise<Cliente360> {
  return authFetch(`/clientes/${encodeURIComponent(id)}/360`);
}

// ---- Timeline unificado del suscriptor ----
export type TimelineEvent = {
  fecha: string;
  tipo: "cliente" | "servicio" | "instalacion" | "factura" | "pago" | "ticket" | "orden";
  titulo: string;
  detalle?: string;
};

export function getCliente360Timeline(id: string): Promise<TimelineEvent[]> {
  return authFetch(`/clientes/${encodeURIComponent(id)}/timeline`);
}

// ---- Cobro: genera el link de pago Wompi de una factura ----
export type CheckoutData = {
  referencia: string;
  montoCents: number;
  moneda: string;
  descripcion?: string;
  checkoutUrl: string;
};

export function paymentsCheckout(input: {
  facturaId?: string;
  montoCents?: number;
  descripcion?: string;
  email?: string;
}): Promise<CheckoutData> {
  return authFetch("/payments/checkout", { method: "POST", body: JSON.stringify(input) });
}

// ---- Soporte (canal de WhatsApp configurable por el admin) ----
export type SupportWhatsapp = {
  numero: string;
  numeroFormateado: string;
  mensaje: string;
  habilitado: boolean;
  url: string | null;
};

export function getSupportWhatsapp(): Promise<SupportWhatsapp> {
  return authFetch("/support/whatsapp");
}

export function setSupportWhatsapp(input: {
  numero: string;
  mensaje?: string;
  habilitado?: boolean;
}): Promise<SupportWhatsapp> {
  return authFetch("/support/whatsapp", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ---- WhatsApp self-hosted (Evolution): vinculación por QR + bandeja ----
export type WaStatus = {
  state: "idle" | "connecting" | "qr" | "open" | "close";
  qrDataUrl: string | null;
  numero: string | null;
};

export type WaChat = {
  jid: string;
  numero: string;
  nombre: string | null;
  ultimoMensaje: string;
  entrante: boolean;
  ts: number;
  noLeidos: number;
};

export function whatsappStatus(): Promise<WaStatus> {
  return authFetch("/whatsapp/status");
}
export function whatsappConnect(): Promise<WaStatus> {
  return authFetch("/whatsapp/connect", { method: "POST" });
}
export function whatsappLogout(): Promise<{ ok: boolean }> {
  return authFetch("/whatsapp/session", { method: "DELETE" });
}
export function whatsappChats(): Promise<WaChat[]> {
  return authFetch("/whatsapp/chats");
}

// ---- Asistente virtual "Cica" (agente de soporte con IA + herramientas) ----
export type CicaAccion = { id: string; label: string; tipo: string };
export type CicaPago = { url: string; referencia: string; monto: number } | null;
export type CicaReply = {
  reply: string;
  ai: boolean;
  acciones: CicaAccion[];
  pago: CicaPago;
};
export type CicaInfo = {
  nombre: string;
  ia: boolean;
  modelo: string | null;
  saludo: string;
  acciones: CicaAccion[];
};

export function assistantInfo(): Promise<CicaInfo> {
  return authFetch("/assistant/info");
}

export function assistantChat(
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<CicaReply> {
  return authFetch("/assistant/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

// ---- Tickets de soporte (los crea Cica o el staff) ----
export type Ticket = {
  id: string;
  codigo: string;
  asunto: string;
  descripcion: string;
  categoria: string;
  contacto: string | null;
  estado: "abierto" | "en_proceso" | "resuelto" | "cerrado";
  origen: string;
  creadoEn: string;
};
export type TicketStats = {
  total: number;
  porEstado: Record<string, number>;
};

export function listTickets(estado?: string): Promise<Ticket[]> {
  const qs = estado ? `?estado=${encodeURIComponent(estado)}` : "";
  return authFetch(`/tickets${qs}`);
}
export function ticketStats(): Promise<TicketStats> {
  return authFetch("/tickets/stats");
}
export function updateTicketEstado(id: string, estado: string): Promise<Ticket> {
  return authFetch(`/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ estado }),
  });
}

export function createTicket(input: {
  asunto: string;
  descripcion: string;
  categoria?: string;
  clienteId?: string;
  contacto?: string;
}): Promise<Ticket> {
  return authFetch("/tickets", { method: "POST", body: JSON.stringify(input) });
}

// ---- Órdenes de trabajo de campo (instalaciones / visitas / reparaciones) ----
// El admin/operador crea y asigna a un técnico; el técnico las ejecuta desde su
// app (cambia estado, sube fotos con la cámara, completa). El admin no sube fotos.
export type OrdenEstado = "asignada" | "en_camino" | "en_sitio" | "completada" | "cancelada";
export type OrdenTipo = "instalacion" | "visita" | "reparacion";
export type OrdenPrioridad = "baja" | "media" | "alta";

export type OrdenFoto = { id: string; url: string; nota?: string; ts: string; autor?: string };

export type OrdenTrabajo = {
  id: string;
  codigo: string;
  tipo: OrdenTipo;
  estado: OrdenEstado;
  prioridad: OrdenPrioridad;
  titulo: string;
  descripcion: string | null;
  direccion: string;
  lat: number | null;
  lng: number | null;
  tecnico: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  contacto: string | null;
  fechaProgramada: string | null;
  notasTecnico: string | null;
  fotos: OrdenFoto[] | null;
  historial: { estado: string; ts: string; por?: string }[] | null;
  creadoPor: string | null;
  creadoEn: string;
  completadaEn: string | null;
};

export type OrdenStats = {
  total: number;
  activas: number;
  porEstado: Record<string, number>;
};

export function listOrdenes(filtros: { estado?: string; tecnico?: string; tipo?: string } = {}): Promise<OrdenTrabajo[]> {
  const qs = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => v != null && v !== "") as [string, string][],
  ).toString();
  return authFetch(`/ordenes${qs ? `?${qs}` : ""}`);
}

export function ordenesStats(): Promise<OrdenStats> {
  return authFetch("/ordenes/stats");
}

export function createOrden(input: {
  titulo: string;
  direccion: string;
  tipo?: OrdenTipo;
  prioridad?: OrdenPrioridad;
  descripcion?: string;
  lat?: number;
  lng?: number;
  tecnico?: string;
  clienteId?: string;
  clienteNombre?: string;
  contacto?: string;
  fechaProgramada?: string;
}): Promise<OrdenTrabajo> {
  return authFetch("/ordenes", { method: "POST", body: JSON.stringify(input) });
}

export function asignarOrden(id: string, tecnico: string | null): Promise<OrdenTrabajo> {
  return authFetch(`/ordenes/${encodeURIComponent(id)}/asignar`, {
    method: "PATCH",
    body: JSON.stringify({ tecnico }),
  });
}

export function updateOrdenEstado(id: string, estado: OrdenEstado): Promise<OrdenTrabajo> {
  return authFetch(`/ordenes/${encodeURIComponent(id)}/estado`, {
    method: "PATCH",
    body: JSON.stringify({ estado }),
  });
}

export function deleteOrden(id: string): Promise<{ id: string }> {
  return authFetch(`/ordenes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type Tecnico = { id: string; username: string; nombre: string; email: string; role: string };
export function listTecnicos(): Promise<Tecnico[]> {
  return authFetch("/ordenes/tecnicos");
}

// ---- Contabilidad (módulo accounting: ledger doble partida PUC) ----
export type CuentaContable = {
  codigo: string;
  nombre: string;
  clase: number;
  naturaleza: "debito" | "credito";
  nivel: string;
  padreCodigo: string | null;
  imputable: boolean;
  exigeTercero: boolean;
  exigeCentro: boolean;
  activa: boolean;
};

export type TerceroContable = {
  id: string;
  documento: string;
  nombre: string;
  tipo: string;
  email: string | null;
};

export type MovimientoContable = {
  id: string;
  cuentaCodigo: string;
  descripcion: string | null;
  debito: string;
  credito: string;
  terceroId: string | null;
  cuenta?: CuentaContable;
  tercero?: TerceroContable | null;
};

export type AsientoContable = {
  id: string;
  numero: string;
  fecha: string;
  periodo: string;
  tipo: string;
  descripcion: string;
  estado: "borrador" | "contabilizado" | "anulado";
  debitoTotal: string;
  creditoTotal: string;
  reversaDeId: string | null;
  creadoPor: string | null;
  movimientos?: MovimientoContable[];
};

export type LineaAsiento = {
  cuenta: string;
  debito?: number;
  credito?: number;
  descripcion?: string;
  terceroId?: string;
  centroCosto?: string;
};

export type PeriodoContable = { periodo: string; estado: "abierto" | "cerrado"; cerradoPor: string | null };

export function listCuentas(opts: { q?: string; imputables?: boolean; clase?: number } = {}): Promise<CuentaContable[]> {
  const qs = new URLSearchParams();
  if (opts.q) qs.set("q", opts.q);
  if (opts.imputables) qs.set("imputables", "true");
  if (opts.clase) qs.set("clase", String(opts.clase));
  return authFetch(`/accounting/cuentas${qs.toString() ? `?${qs}` : ""}`);
}
export function crearCuenta(input: { codigo: string; nombre: string; imputable?: boolean; exigeTercero?: boolean }): Promise<CuentaContable> {
  return authFetch("/accounting/cuentas", { method: "POST", body: JSON.stringify(input) });
}
export function listTercerosContables(q?: string): Promise<TerceroContable[]> {
  return authFetch(`/accounting/terceros${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}
export function crearTerceroContable(input: { documento: string; nombre: string; tipo?: string }): Promise<TerceroContable> {
  return authFetch("/accounting/terceros", { method: "POST", body: JSON.stringify(input) });
}
export function listAsientos(opts: { periodo?: string; tipo?: string; estado?: string } = {}): Promise<AsientoContable[]> {
  const qs = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]).toString();
  return authFetch(`/accounting/asientos${qs ? `?${qs}` : ""}`);
}
export function getAsiento(id: string): Promise<AsientoContable> {
  return authFetch(`/accounting/asientos/${encodeURIComponent(id)}`);
}
export function crearAsiento(input: { fecha?: string; tipo?: string; descripcion: string; lineas: LineaAsiento[]; contabilizar?: boolean }): Promise<AsientoContable> {
  return authFetch("/accounting/asientos", { method: "POST", body: JSON.stringify(input) });
}
export function reversarAsiento(id: string): Promise<AsientoContable> {
  return authFetch(`/accounting/asientos/${encodeURIComponent(id)}/reversar`, { method: "POST" });
}
export function listPeriodos(): Promise<PeriodoContable[]> {
  return authFetch("/accounting/periodos");
}
export function cerrarPeriodo(periodo: string): Promise<PeriodoContable> {
  return authFetch(`/accounting/periodos/${encodeURIComponent(periodo)}/cerrar`, { method: "POST" });
}
export function accountingDashboard(periodo?: string): Promise<{ periodo: string; ingresos: number; gastos: number; utilidadNeta: number; cartera: number; bancosCaja: number; asientosDelPeriodo: number }> {
  return authFetch(`/accounting/reportes/dashboard${periodo ? `?periodo=${periodo}` : ""}`);
}
export function balanceComprobacion(periodo?: string): Promise<{ periodo: string; filas: any[]; totales: any; cuadra: boolean }> {
  return authFetch(`/accounting/reportes/balance${periodo ? `?periodo=${periodo}` : ""}`);
}
export function estadoResultados(periodo?: string): Promise<{ periodo: string; ingresos: number; costos: number; gastos: number; utilidadBruta: number; utilidadNeta: number; detalle: any[] }> {
  return authFetch(`/accounting/reportes/resultados${periodo ? `?periodo=${periodo}` : ""}`);
}
export function balanceGeneral(hasta?: string): Promise<{ hasta: string; activo: number; pasivo: number; patrimonio: number; resultadoEjercicio: number; pasivoMasPatrimonio: number; cuadra: boolean; grupos: any }> {
  return authFetch(`/accounting/reportes/balance-general${hasta ? `?hasta=${hasta}` : ""}`);
}
export function situacionNiif(hasta?: string): Promise<{ hasta: string; grupos: any; totales: any; cuadra: boolean }> {
  return authFetch(`/accounting/reportes/situacion-niif${hasta ? `?hasta=${hasta}` : ""}`);
}
export function libroMayor(cuenta: string, periodo?: string): Promise<{ cuenta: any; movimientos: any[]; saldoFinal: number }> {
  return authFetch(`/accounting/reportes/mayor?cuenta=${encodeURIComponent(cuenta)}${periodo ? `&periodo=${periodo}` : ""}`);
}

// ---- Cartera / Cobranza (módulo collections) ----
export type AgingBuckets = { porVencer: number; d1_30: number; d31_60: number; d61_90: number; d90mas: number };
export type AgingCliente = {
  cliente: { id: string; codigo: string; nombre: string; estado: string; telefono: string | null; email: string | null };
  ubicacion: { barrio: string | null; comuna: string | null; nap: string | null };
  buckets: AgingBuckets;
  total: number;
  facturas: number;
  maxDias: number;
};
export type Aging = {
  generadoEn: string;
  resumen: AgingBuckets;
  totalCartera: number;
  totalVencido: number;
  clientesConDeuda: number;
  clientes: AgingCliente[];
};
export type AgingZona = { dimension: string; grupos: { nombre: string; total: number; vencido: number; clientes: number; buckets: AgingBuckets }[] };

export function getAging(opts: { barrio?: string; nap?: string; soloVencidos?: boolean } = {}): Promise<Aging> {
  const qs = new URLSearchParams();
  if (opts.barrio) qs.set("barrio", opts.barrio);
  if (opts.nap) qs.set("nap", opts.nap);
  if (opts.soloVencidos) qs.set("soloVencidos", "true");
  return authFetch(`/collections/aging${qs.toString() ? `?${qs}` : ""}`);
}
export function getAgingPorZona(dim: "barrio" | "comuna" | "nap" = "barrio"): Promise<AgingZona> {
  return authFetch(`/collections/aging/por-zona?dim=${dim}`);
}
export function carteraResumen(): Promise<{ totalCartera: number; totalVencido: number; clientesConDeuda: number; buckets: AgingBuckets }> {
  return authFetch("/collections/resumen");
}
export function carteraCliente(id: string): Promise<{ clienteId: string; total: number; vencido: number; facturas: any[] }> {
  return authFetch(`/collections/cliente/${encodeURIComponent(id)}`);
}

// ---- Facturación recurrente (módulo billing) ----
export type BillingPreview = {
  periodo: string;
  facturasAGenerar: number;
  totalAFacturar: number;
  items: { cliente: string; plan: string; subtotal: number; iva: number; total: number; dias: number; prorrateo: boolean }[];
};
export type BillingRun = { periodo: string; dryRun: boolean; generadas: number; contabilizadas: number; totalFacturado: number; errores: { cliente: string; error: string }[] };
export type SuspensionResult = { aplicado: boolean; diasGracia: number; facturasVencidas: number; marcadasVencidas: number; serviciosASuspender: number; detalle: { codigo: string; nombre: string }[] };

export function billingPreview(periodo: string): Promise<BillingPreview> {
  return authFetch(`/billing/preview?periodo=${encodeURIComponent(periodo)}`);
}
export function billingRun(periodo: string, dryRun = false): Promise<BillingRun> {
  return authFetch("/billing/run", { method: "POST", body: JSON.stringify({ periodo, dryRun }) });
}
export function suspenderMorosos(aplicar: boolean, diasGracia?: number): Promise<SuspensionResult> {
  return authFetch("/billing/suspender-morosos", { method: "POST", body: JSON.stringify({ aplicar, diasGracia }) });
}

// ---- Conciliación bancaria (módulo banking) ----
export type CuentaBancaria = { id: string; nombre: string; banco: string | null; numero: string | null; cuentaPuc: string };
export type MovimientoBancario = { id: string; fecha: string; descripcion: string; referencia: string | null; valor: string; estado: string };

export function listCuentasBancarias(): Promise<CuentaBancaria[]> { return authFetch("/banking/cuentas"); }
export function crearCuentaBancaria(input: { nombre: string; banco?: string; numero?: string; cuentaPuc: string }): Promise<CuentaBancaria> {
  return authFetch("/banking/cuentas", { method: "POST", body: JSON.stringify(input) });
}
export function importarExtracto(cuentaBancariaId: string, contenido: string): Promise<{ importados: number; duplicados: number; errores: string[]; total: number }> {
  return authFetch("/banking/import", { method: "POST", body: JSON.stringify({ cuentaBancariaId, contenido }) });
}
export function movimientosSinConciliar(cuenta?: string): Promise<MovimientoBancario[]> {
  return authFetch(`/banking/sin-conciliar${cuenta ? `?cuenta=${cuenta}` : ""}`);
}
export function bankingResumen(cuenta?: string): Promise<{ total: number; sinConciliar: number; conciliados: number; montoSinConciliar: number }> {
  return authFetch(`/banking/resumen${cuenta ? `?cuenta=${cuenta}` : ""}`);
}
export function sugerenciasConciliacion(movId: string): Promise<{ movimiento: MovimientoBancario; sugerencias: { pagoTxId: string; referencia: string; metodo: string | null; monto: number; fecha: string; confianza: string }[] }> {
  return authFetch(`/banking/movimientos/${movId}/sugerencias`);
}
export function conciliarMovimiento(movId: string, input: { contrapartida?: string; matchPagoTxId?: string; descripcion?: string }): Promise<{ ok: boolean; asiento: string }> {
  return authFetch(`/banking/movimientos/${movId}/conciliar`, { method: "POST", body: JSON.stringify(input) });
}
export function ignorarMovimiento(movId: string): Promise<{ ok: boolean }> {
  return authFetch(`/banking/movimientos/${movId}/ignorar`, { method: "POST" });
}

// ---- Cobranza automática (módulo dunning) ----
export type DunningObjetivo = { clienteId: string; nombre: string; telefono: string | null; bucket: string; saldo: number; dias: number; mensaje: string; yaEnviado: boolean; habilitado: boolean };
export type DunningPreview = { mes: string; total: number; aEnviar: number; objetivos: DunningObjetivo[] };

export function dunningPreview(): Promise<DunningPreview> { return authFetch("/dunning/preview"); }
export function dunningRun(aplicar: boolean): Promise<{ aplicado: boolean; mes: string; enviados: number; fallidos: number; omitidos: number; detalle: any[] }> {
  return authFetch("/dunning/run", { method: "POST", body: JSON.stringify({ aplicar }) });
}
export function dunningHistorial(mes?: string): Promise<any[]> { return authFetch(`/dunning/historial${mes ? `?mes=${mes}` : ""}`); }

// ---- Cuentas por pagar (módulo payables) ----
export type LineaCompra = { cuenta: string; descripcion?: string; base: number; ivaPct?: number };
export type FacturaCompra = {
  id: string; numero: string; proveedorNombre: string; concepto: string;
  fecha: string; fechaVencimiento: string; subtotal: string; ivaDescontable: string;
  retefuente: string; reteIva: string; reteIca: string; totalAPagar: string; estado: string;
};

export function listCompras(estado?: string): Promise<FacturaCompra[]> {
  return authFetch(`/payables${estado ? `?estado=${estado}` : ""}`);
}
export function comprasResumen(): Promise<{ totalPorPagar: number; vencido: number; facturasPendientes: number }> {
  return authFetch("/payables/resumen");
}
export function crearCompra(input: {
  proveedor: { documento: string; nombre: string };
  numeroProveedor?: string; concepto: string; fechaVencimiento?: string;
  lineas: LineaCompra[]; retefuente?: number; reteIva?: number; reteIca?: number;
}): Promise<FacturaCompra> {
  return authFetch("/payables", { method: "POST", body: JSON.stringify(input) });
}
export function pagarCompra(id: string, cuentaBanco?: string): Promise<FacturaCompra> {
  return authFetch(`/payables/${encodeURIComponent(id)}/pagar`, { method: "POST", body: JSON.stringify({ cuentaBanco }) });
}

// ---- Motor de impuestos (módulo taxes) ----
export type ReglaImpuesto = { codigo: string; tipo: string; nombre: string; porcentaje: string; baseMinima: string; cuentaPuc: string; activa: boolean };
export function listReglasImpuesto(tipo?: string): Promise<ReglaImpuesto[]> {
  return authFetch(`/taxes/reglas${tipo ? `?tipo=${tipo}` : ""}`);
}
export function calcularImpuestos(input: { base: number; ivaMonto?: number; retefuenteCodigo?: string; aplicarReteIva?: boolean; reteIcaCodigo?: string }): Promise<{ base: number; iva: number; retefuente: number; reteIva: number; reteIca: number; netoAPagar: number }> {
  return authFetch("/taxes/calcular", { method: "POST", body: JSON.stringify(input) });
}

// ---- Descarga de archivos (CSV/Excel) con autenticación ----
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`No se pudo descargar (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Activos fijos y depreciación (módulo assets) ----
export type ActivoFijo = { id: string; nombre: string; valorAdquisicion: string; valorResidual: string; vidaUtilMeses: number; depreciacionAcumulada: string; estado: string };
export function listActivosFijos(): Promise<ActivoFijo[]> { return authFetch("/assets"); }
export function crearActivoFijo(input: { nombre: string; valorAdquisicion: number; vidaUtilMeses: number; valorResidual?: number; fechaAdquisicion?: string }): Promise<ActivoFijo> {
  return authFetch("/assets", { method: "POST", body: JSON.stringify(input) });
}
export function depreciacionPreview(periodo: string): Promise<{ periodo: string; activos: number; totalDepreciacion: number; items: any[] }> {
  return authFetch(`/assets/depreciacion/preview?periodo=${periodo}`);
}
export function depreciacionRun(periodo: string, dryRun = false): Promise<{ periodo: string; procesados: number; totalDepreciacion: number }> {
  return authFetch("/assets/depreciacion/run", { method: "POST", body: JSON.stringify({ periodo, dryRun }) });
}

// ---- Información exógena (módulo exogena) ----
export type FormatoExogena = { codigo: string; nombre: string; descripcion: string };
export function listFormatosExogena(): Promise<FormatoExogena[]> { return authFetch("/exogena/formatos"); }
export function generarExogena(formato: string, anio: number): Promise<{ formato: string; nombre: string; anio: number; terceros: number; total: number; filas: { tipoDocumento: string; nit: string; dv: string | null; nombre: string; valor: number }[] }> {
  return authFetch(`/exogena/${formato}?anio=${anio}`);
}

// ---- Nómina (módulo payroll) ----
export type Empleado = { id: string; nombre: string; documento: string; cargo: string | null; salarioBase: string; estado: string };
export function listEmpleados(): Promise<Empleado[]> { return authFetch("/payroll/empleados"); }
export function crearEmpleado(input: { nombre: string; documento: string; cargo?: string; salarioBase: number }): Promise<Empleado> {
  return authFetch("/payroll/empleados", { method: "POST", body: JSON.stringify(input) });
}
export function nominaPreview(periodo: string): Promise<{ periodo: string; empleados: number; totalDevengado: number; totalNeto: number; items: any[] }> {
  return authFetch(`/payroll/preview?periodo=${periodo}`);
}
export function nominaRun(periodo: string, dryRun = false): Promise<{ periodo: string; liquidados: number; totalNeto: number }> {
  return authFetch("/payroll/run", { method: "POST", body: JSON.stringify({ periodo, dryRun }) });
}

// ---- Cash application / Recibos de caja (módulo cash) ----
export type ReciboCaja = {
  id: string; numero: string; fecha: string; clienteId: string | null; clienteNombre: string | null;
  medioPago: string; referencia: string | null; montoRecibido: string; montoAplicado: string;
  saldoPorAplicar: string; estado: string; origen: string;
};
export type FacturaPendiente = { id: string; periodo: string; total: number; saldo: number; fechaVencimiento: string };

export function listRecibos(estado?: string): Promise<ReciboCaja[]> { return authFetch(`/cash/recibos${estado ? `?estado=${estado}` : ""}`); }
export function cashResumen(): Promise<{ recibosPendientes: number; totalPorAplicar: number; huerfanos: number }> { return authFetch("/cash/resumen"); }
export function facturasPendientesCliente(clienteId: string): Promise<FacturaPendiente[]> { return authFetch(`/cash/cliente/${clienteId}/facturas`); }
export function crearRecibo(input: { clienteId?: string; medioPago: string; montoRecibido: number; referencia?: string; aplicaciones?: { facturaId: string; monto: number }[] }): Promise<ReciboCaja> {
  return authFetch("/cash/recibos", { method: "POST", body: JSON.stringify(input) });
}
export function aplicarSaldoRecibo(id: string, aplicaciones: { facturaId: string; monto: number }[]): Promise<ReciboCaja> {
  return authFetch(`/cash/recibos/${id}/aplicar`, { method: "POST", body: JSON.stringify({ aplicaciones }) });
}
export function anularRecibo(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/cash/recibos/${id}/anular`, { method: "POST" });
}

// ---- Workbench del contador (módulo workbench) ----
export type WorkbenchCard = { clave: string; titulo: string; valor: number; detalle: string; alerta: string | null; tab: string };
export function workbench(): Promise<{ periodo: string; tarjetas: WorkbenchCard[] }> { return authFetch("/workbench"); }
