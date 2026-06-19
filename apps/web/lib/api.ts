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
  role: "admin" | "operador" | "tecnico";
};

// ---- almacenamiento ----
export function setSession(accessToken: string, refreshToken: string, user: SessionUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // cookie para el middleware (1 día)
  document.cookie = `${TOKEN_KEY}=${accessToken}; path=/; max-age=86400; samesite=lax`;
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
