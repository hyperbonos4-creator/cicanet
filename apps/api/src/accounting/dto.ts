import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LineaDto {
  @IsString() cuenta: string;
  @IsOptional() @IsNumber() @Min(0) debito?: number;
  @IsOptional() @IsNumber() @Min(0) credito?: number;
  @IsOptional() @IsString() @MaxLength(300) descripcion?: string;
  @IsOptional() @IsString() terceroId?: string;
  @IsOptional() @IsString() centroCosto?: string;
}

export class CrearAsientoDto {
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsIn(['manual', 'apertura', 'venta', 'recaudo', 'compra', 'gasto', 'ajuste', 'depreciacion', 'cierre'])
  tipo?: string;

  @IsString() @MinLength(3) @MaxLength(500) descripcion: string;

  @IsOptional() @IsString() referenciaTipo?: string;
  @IsOptional() @IsString() referenciaId?: string;
  @IsOptional() @IsBoolean() contabilizar?: boolean;

  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => LineaDto)
  lineas: LineaDto[];
}

export class CrearCuentaDto {
  @IsString() codigo: string;
  @IsString() @MinLength(2) @MaxLength(200) nombre: string;
  @IsOptional() @IsBoolean() imputable?: boolean;
  @IsOptional() @IsBoolean() exigeTercero?: boolean;
  @IsOptional() @IsBoolean() exigeCentro?: boolean;
}

export class CrearTerceroDto {
  @IsString() documento: string;
  @IsString() @MinLength(2) @MaxLength(200) nombre: string;
  @IsOptional() @IsIn(['cliente', 'proveedor', 'empleado', 'otro']) tipo?: string;
  @IsOptional() @IsString() tipoDocumento?: string;
  @IsOptional() @IsString() dv?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() clienteId?: string;
}
