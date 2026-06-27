import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content: string;
}

export class ChatDto {
  /** Historial de la conversación (incluye el último mensaje del usuario al final). */
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  messages: ChatTurnDto[];
}

export class QuickAskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;
}
