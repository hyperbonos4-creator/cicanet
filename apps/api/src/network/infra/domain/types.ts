// Modelo de dominio del Gemelo Digital de la Red (network-digital-twin).
// Ficha universal de activos + campos por tipo, fibra, sitios, cobertura y sectores.

export type AssetType =
  | 'POP'
  | 'OLT'
  | 'Switch'
  | 'Router'
  | 'NAP'
  | 'Splitter'
  | 'UPS'
  | 'Servidor'
  | 'Camara'
  | 'Fibra'
  | 'Empalme'
  | 'Poste'
  | 'ONU'
  | 'Cliente';

export const ASSET_TYPES: AssetType[] = [
  'POP', 'OLT', 'Switch', 'Router', 'NAP', 'Splitter', 'UPS',
  'Servidor', 'Camara', 'Fibra', 'Empalme', 'Poste', 'ONU', 'Cliente',
];

export type AssetStatus =
  | 'Activo'
  | 'Inactivo'
  | 'Mantenimiento'
  | 'Retirado'
  | 'Dañado';

export const ASSET_STATUSES: AssetStatus[] = [
  'Activo', 'Inactivo', 'Mantenimiento', 'Retirado', 'Dañado',
];

/** Estados que representan una falla operativa (vista Incidencias). */
export const FAILURE_STATUSES: AssetStatus[] = ['Inactivo', 'Mantenimiento', 'Dañado'];

export type OwnershipRegime = 'Arrendado' | 'Comodato' | 'Tercero';
export const OWNERSHIP_REGIMES: OwnershipRegime[] = ['Arrendado', 'Comodato', 'Tercero'];

export type MonitorProtocol = 'SNMP' | 'API' | 'SSH';
export const MONITOR_PROTOCOLS: MonitorProtocol[] = ['SNMP', 'API', 'SSH'];

export type Rol = 'admin' | 'operador' | 'tecnico';

export type LngLat = { lng: number; lat: number };
export type LineStringCoords = number[][]; // [ [lng,lat], ... ]
export type PolygonCoords = number[][][]; // [ anillo exterior, ...huecos ]

// Alias del modelo de dominio (design.md → Data Models): geometrías GeoJSON-like.
export type LineString = LineStringCoords; // [ [lng,lat], ... ]
export type Polygon = PolygonCoords; // anillos [ [ [lng,lat], ... ] ]

export interface Economics {
  costoCompra?: number;
  costoInstalacion?: number;
  proveedor?: string;
  fechaCompra?: string;
  fechaFinGarantia?: string;
}

export interface Risk {
  expuestoRobo?: boolean;
  expuestoInundacion?: boolean;
  energiaRegulada?: boolean;
}

export interface Management {
  ip?: string;
  puerto?: number;
  protocolos?: MonitorProtocol[];
}

// ---- Evidencia (fotos / documentos) ----

export type PhotoCategory =
  | 'vista_general'
  | 'frontal'
  | 'placa_serial'
  | 'instalacion'
  | 'pano360';
export const PHOTO_CATEGORIES: PhotoCategory[] = [
  'vista_general', 'frontal', 'placa_serial', 'instalacion', 'pano360',
];

export interface PhotoRef {
  id: string;
  categoria: PhotoCategory;
  url: string;
  subidoEn: string;
  autor?: string;
}

export interface DocRef {
  id: string;
  nombre: string;
  url: string;
  subidoEn: string;
}

// ---- Historial de eventos del activo ----

export type AssetEventType = 'instalacion' | 'mantenimiento' | 'cambio_puerto' | 'incidencia';
export const ASSET_EVENT_TYPES: AssetEventType[] = [
  'instalacion', 'mantenimiento', 'cambio_puerto', 'incidencia',
];

export interface AssetEvent {
  id: string;
  tipo: AssetEventType;
  descripcion?: string;
  fecha: string;
  autor?: string;
}

// ---- Atributos específicos por tipo (R4.1–R4.8) ----

export type FiberMode = 'monomodo' | 'multimodo';
export const FIBER_MODES: FiberMode[] = ['monomodo', 'multimodo'];

export type FiberStrands = 12 | 24 | 48 | 96 | 144;
export const FIBER_STRANDS: FiberStrands[] = [12, 24, 48, 96, 144];

export type NapSupport = 'poste' | 'fachada' | 'gabinete';
export const NAP_SUPPORTS: NapSupport[] = ['poste', 'fachada', 'gabinete'];

export interface OltAttributes {
  puertosPon?: number;
  puertosSfp?: number;
  ip?: string;
  firmware?: string;
  capacidadOnus?: number;
}

export interface RouterAttributes {
  ip?: string;
  firmware?: string;
  proveedorInternet?: string;
}

export interface SwitchAttributes {
  puertos?: number;
  puertosPoe?: number;
  velocidad?: string;
  capacidadSwitching?: string;
}

export interface UpsAttributes {
  capacidadVa?: number;
  autonomia?: string;
  baterias?: number;
  ultimoCambioBateria?: string;
}

export interface ServidorAttributes {
  cpu?: string;
  ram?: string;
  disco?: string;
  so?: string;
}

export interface FibraAttributes {
  modo?: FiberMode;
  hilos?: FiberStrands;
  longitud?: number;
  origenId?: string | null;
  destinoId?: string | null;
}

export interface EmpalmeAttributes {
  fibrasFusionadas?: number;
  fechaFusion?: string;
  tecnico?: string;
}

export interface NapAttributes {
  codigo?: string;
  puertosTotal?: number;
  puertosUsados?: number;
  alturaInstalacion?: number;
  soporte?: NapSupport;
  /** Distancia máxima de tendido permitida para vender desde esta NAP (metros). */
  distanciaMax?: number;
  /** Polígono comercial donde la NAP puede vender. */
  poligonoComercial?: PolygonCoords;
  /** Calles comerciales asociadas a la NAP. */
  callesComerciales?: string[];
}

/** Unión discriminada de atributos por tipo. Los tipos sin campos propios usan {}. */
export type TypeAttributes =
  | ({ tipo: 'OLT' } & OltAttributes)
  | ({ tipo: 'Router' } & RouterAttributes)
  | ({ tipo: 'Switch' } & SwitchAttributes)
  | ({ tipo: 'UPS' } & UpsAttributes)
  | ({ tipo: 'Servidor' } & ServidorAttributes)
  | ({ tipo: 'Fibra' } & FibraAttributes)
  | ({ tipo: 'Empalme' } & EmpalmeAttributes)
  | ({ tipo: 'NAP' } & NapAttributes)
  | { tipo: 'POP' | 'Splitter' | 'Camara' | 'Poste' | 'ONU' | 'Cliente' };

/** Ficha universal: todos los activos heredan estos campos. */
export interface Asset {
  id: string;
  tipo: AssetType;
  nombre: string;
  marca?: string;
  modelo?: string;
  serie?: string;
  direccion?: string;
  barrio?: string;
  comuna?: string;
  ciudad?: string;
  lng: number;
  lat: number;
  estado: AssetStatus;
  propio: boolean;
  regimen?: OwnershipRegime;
  fechaInstalacion?: string;
  proveedor?: string;
  padreId?: string | null; // topología (de qué activo depende)
  sitioId?: string | null;
  gestion?: Management;
  economia?: Economics;
  riesgo?: Risk;
  /** Plan mensual (COP) cuando el activo es un Cliente — base de ingresos. */
  planMensual?: number;
  fotos?: PhotoRef[];
  documentos?: DocRef[];
  historial?: AssetEvent[];
  // Campos específicos por tipo (OLT/NAP/Switch/UPS/Servidor/Fibra/Empalme...).
  atributos: Record<string, any>;
  creadoPor?: string;
  creadoEn: string;
}

/** Proyección de un Asset tipo NAP para los cálculos de capacidad (design.md → Data Models). */
export interface Nap {
  id: string;
  puertosTotal: number;
  puertosOcupados: number;
  /** Distancia máxima de tendido permitida (metros). */
  distanciaMax?: number;
  ubicacion: LngLat;
}

/** Segmento de fibra: trayecto físico entre dos puntos/activos. */
export interface FiberSegment {
  id: string;
  nombre?: string;
  tipoFibra?: FiberMode;
  hilos?: number;
  origenId?: string | null;
  destinoId?: string | null;
  origenDireccion?: string;
  destinoDireccion?: string;
  origen: LngLat;
  destino: LngLat;
  trazado: LineStringCoords; // [origen, ..., destino]
  longitud: number; // metros
  creadoPor?: string;
  creadoEn: string;
}

export interface Site {
  id: string;
  nombre: string;
  lng: number;
  lat: number;
  activosIds?: string[];
  creadoEn: string;
}

// ---- Conectividad a nivel de puerto (Fase puerto) ----

export type PortRole = 'entrada' | 'salida';
export const PORT_ROLES: PortRole[] = ['entrada', 'salida'];

export type PortState = 'libre' | 'ocupado' | 'reservado' | 'dañado';
export const PORT_STATES: PortState[] = ['libre', 'ocupado', 'reservado', 'dañado'];

/** Puerto físico de un activo (NAP/OLT/Splitter). */
export interface Port {
  id: string;
  activoId: string;
  numero: number;
  rol: PortRole;
  estado: PortState;
  etiqueta?: string;
  creadoEn: string;
}

/** Conexión (arista) puerto↔puerto o puerto↔servicio. */
export interface Connection {
  id: string;
  aPuertoId: string;
  bPuertoId?: string | null;
  servicioId?: string | null;
  hilo?: number | null;
  segmentoFibraId?: string | null;
  estado: 'activa' | 'inactiva';
  creadoPor?: string;
  creadoEn: string;
}

/** Área de cobertura (polígono donde la ISP puede ofrecer servicio). */
export interface CoverageArea {
  id: string;
  nombre: string;
  estado?: 'ftth' | 'parcial' | 'planeada';
  poligono: PolygonCoords;
  creadoEn: string;
}

/** Sector comercial: subdivisión geográfica para medir penetración. */
export interface Sector {
  id: string;
  nombre: string;
  hogaresEstimados: number;
  poligono?: PolygonCoords;
  creadoEn: string;
}

/** Actor del staff (para autoría/RBAC en el dominio). */
export interface Actor {
  id?: string;
  nombre?: string;
  rol: Rol;
}

// ---- Vistas del mapa ----

export type MapView = 'cobertura' | 'capacidad' | 'incidencias' | 'activos' | 'expansion';
export const MAP_VIEWS: MapView[] = [
  'cobertura', 'capacidad', 'incidencias', 'activos', 'expansion',
];

export type CapacitySemaphore = 'verde' | 'amarillo' | 'rojo';

export type BBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };
