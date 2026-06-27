// Modelo de dominio del Suscriptor (cliente) de un ISP.
// Captura los 4 bloques que maneja un operador serio: identificación y
// contacto, dirección de instalación, plan/datos técnicos y facturación/contrato.

export type TipoDocumento = 'CC' | 'CE' | 'NIT' | 'PAS';
export type TipoCliente = 'residencial' | 'empresarial';
export type Tecnologia = 'FTTH' | 'Inalambrico' | 'HFC';
export type EstadoServicio =
  | 'instalacion_pendiente'
  | 'activo'
  | 'suspendido'
  | 'cortado';
export type EstadoCliente = 'activo' | 'suspendido' | 'retirado' | 'moroso';
export type CicloFacturacion = 'mensual' | 'bimestral' | 'anticipado';
export type MetodoPago = 'efectivo' | 'transferencia' | 'tarjeta' | 'PSE';

export const TIPOS_DOCUMENTO: TipoDocumento[] = ['CC', 'CE', 'NIT', 'PAS'];
export const TIPOS_CLIENTE: TipoCliente[] = ['residencial', 'empresarial'];
export const TECNOLOGIAS: Tecnologia[] = ['FTTH', 'Inalambrico', 'HFC'];
export const ESTADOS_SERVICIO: EstadoServicio[] = [
  'instalacion_pendiente',
  'activo',
  'suspendido',
  'cortado',
];
export const ESTADOS_CLIENTE: EstadoCliente[] = [
  'activo',
  'suspendido',
  'retirado',
  'moroso',
];
export const CICLOS_FACTURACION: CicloFacturacion[] = [
  'mensual',
  'bimestral',
  'anticipado',
];
export const METODOS_PAGO: MetodoPago[] = [
  'efectivo',
  'transferencia',
  'tarjeta',
  'PSE',
];

/** Ficha completa del suscriptor. */
export interface Cliente {
  id: string; // CLI-0001

  // --- 1. Identificación y contacto ---
  tipoDocumento: TipoDocumento;
  documento: string;
  nombre: string; // nombre completo o razón social
  tipoCliente: TipoCliente;
  email?: string;
  telefonoMovil?: string;
  telefonoFijo?: string;

  // --- 2. Dirección de instalación ---
  direccion: string;
  barrio?: string;
  comuna?: string;
  ciudad: string;
  departamento?: string;
  estrato?: number; // 1-6
  lat?: number;
  lng?: number;
  referencias?: string;

  // --- 3. Plan y datos técnicos ---
  plan: string;
  velocidadBajada?: number; // Mbps
  velocidadSubida?: number; // Mbps
  tecnologia: Tecnologia;
  napId?: string; // referencia a un activo NAP del módulo infra
  puerto?: number;
  onuSerial?: string;
  ip?: string;
  vlan?: number;
  fechaInstalacion?: string; // ISO date
  estadoServicio: EstadoServicio;

  // --- 4. Facturación y contrato ---
  cicloFacturacion?: CicloFacturacion;
  diaCorte?: number; // 1-31
  metodoPago?: MetodoPago;
  tarifa?: number;
  saldo?: number;
  numeroContrato?: string;
  fechaInicioContrato?: string; // ISO date
  fechaFinContrato?: string; // ISO date

  // --- Meta ---
  estado: EstadoCliente;
  notas?: string;
  creadoPor?: string;
  creadoEn: string;
  actualizadoEn?: string;
}

export interface ClienteStats {
  total: number;
  porEstado: Record<EstadoCliente, number>;
  porServicio: Record<EstadoServicio, number>;
  porTecnologia: Record<Tecnologia, number>;
  ingresoMensual: number; // suma de tarifas de clientes activos
  saldoPendiente: number; // suma de saldos
}
