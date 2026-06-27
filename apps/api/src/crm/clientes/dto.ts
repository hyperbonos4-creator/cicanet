import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  CICLOS_FACTURACION,
  ESTADOS_CLIENTE,
  ESTADOS_SERVICIO,
  METODOS_PAGO,
  TECNOLOGIAS,
  TIPOS_CLIENTE,
  TIPOS_DOCUMENTO,
} from './domain/types';

export class CreateClienteDto {
  // 1. Identificación y contacto
  @IsIn(TIPOS_DOCUMENTO) tipoDocumento: any;
  @IsString() @MinLength(3) documento: string;
  @IsString() @MinLength(2) nombre: string;
  @IsIn(TIPOS_CLIENTE) tipoCliente: any;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() telefonoMovil?: string;
  @IsOptional() @IsString() telefonoFijo?: string;

  // 2. Dirección de instalación
  @IsString() @MinLength(3) direccion: string;
  @IsOptional() @IsString() barrio?: string;
  @IsOptional() @IsString() comuna?: string;
  @IsString() @MinLength(2) ciudad: string;
  @IsOptional() @IsString() departamento?: string;
  @IsOptional() @IsInt() @Min(1) @Max(6) estrato?: number;
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
  @IsOptional() @IsString() referencias?: string;

  // 3. Plan y datos técnicos
  @IsString() @MinLength(1) plan: string;
  @IsOptional() @IsNumber() velocidadBajada?: number;
  @IsOptional() @IsNumber() velocidadSubida?: number;
  @IsIn(TECNOLOGIAS) tecnologia: any;
  @IsOptional() @IsString() napId?: string;
  @IsOptional() @IsInt() puerto?: number;
  @IsOptional() @IsString() onuSerial?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsInt() vlan?: number;
  @IsOptional() @IsString() fechaInstalacion?: string;
  @IsOptional() @IsIn(ESTADOS_SERVICIO) estadoServicio?: any;

  // 4. Facturación y contrato
  @IsOptional() @IsIn(CICLOS_FACTURACION) cicloFacturacion?: any;
  @IsOptional() @IsInt() @Min(1) @Max(31) diaCorte?: number;
  @IsOptional() @IsIn(METODOS_PAGO) metodoPago?: any;
  @IsOptional() @IsNumber() tarifa?: number;
  @IsOptional() @IsNumber() saldo?: number;
  @IsOptional() @IsString() numeroContrato?: string;
  @IsOptional() @IsString() fechaInicioContrato?: string;
  @IsOptional() @IsString() fechaFinContrato?: string;

  // Meta
  @IsOptional() @IsIn(ESTADOS_CLIENTE) estado?: any;
  @IsOptional() @IsString() notas?: string;
}

/** Igual a Create pero todo opcional (PATCH/PUT parcial). */
export class UpdateClienteDto {
  @IsOptional() @IsIn(TIPOS_DOCUMENTO) tipoDocumento?: any;
  @IsOptional() @IsString() documento?: string;
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsIn(TIPOS_CLIENTE) tipoCliente?: any;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() telefonoMovil?: string;
  @IsOptional() @IsString() telefonoFijo?: string;

  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() barrio?: string;
  @IsOptional() @IsString() comuna?: string;
  @IsOptional() @IsString() ciudad?: string;
  @IsOptional() @IsString() departamento?: string;
  @IsOptional() @IsInt() @Min(1) @Max(6) estrato?: number;
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
  @IsOptional() @IsString() referencias?: string;

  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsNumber() velocidadBajada?: number;
  @IsOptional() @IsNumber() velocidadSubida?: number;
  @IsOptional() @IsIn(TECNOLOGIAS) tecnologia?: any;
  @IsOptional() @IsString() napId?: string;
  @IsOptional() @IsInt() puerto?: number;
  @IsOptional() @IsString() onuSerial?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsInt() vlan?: number;
  @IsOptional() @IsString() fechaInstalacion?: string;
  @IsOptional() @IsIn(ESTADOS_SERVICIO) estadoServicio?: any;

  @IsOptional() @IsIn(CICLOS_FACTURACION) cicloFacturacion?: any;
  @IsOptional() @IsInt() @Min(1) @Max(31) diaCorte?: number;
  @IsOptional() @IsIn(METODOS_PAGO) metodoPago?: any;
  @IsOptional() @IsNumber() tarifa?: number;
  @IsOptional() @IsNumber() saldo?: number;
  @IsOptional() @IsString() numeroContrato?: string;
  @IsOptional() @IsString() fechaInicioContrato?: string;
  @IsOptional() @IsString() fechaFinContrato?: string;

  @IsOptional() @IsIn(ESTADOS_CLIENTE) estado?: any;
  @IsOptional() @IsString() notas?: string;
}
