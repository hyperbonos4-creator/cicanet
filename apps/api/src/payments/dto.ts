import { IsEmail, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateCheckoutDto {
  /** Si se paga una factura existente, su id (toma el total de la factura). */
  @IsOptional()
  @IsString()
  facturaId?: string;

  /** Monto en centavos (si no hay factura: pago directo de un valor). */
  @IsOptional()
  @IsInt()
  @Min(1500) // mínimo razonable (~15 COP*100); Wompi exige montos válidos
  montoCents?: number;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
