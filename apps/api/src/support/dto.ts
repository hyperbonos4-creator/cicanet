import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Configuración del canal de soporte por WhatsApp (editable por el admin). */
export class UpdateWhatsappSupportDto {
  /** Número de WhatsApp de la empresa. Acepta formatos con +, espacios o guiones. */
  @IsString()
  @MinLength(7, { message: 'El número de WhatsApp no es válido.' })
  @MaxLength(20)
  numero!: string;

  /** Mensaje que se precarga en el chat al abrirlo (opcional). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  mensaje?: string;

  /** Si está deshabilitado, la app oculta/avisa que soporte no está disponible. */
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
