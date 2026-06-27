import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RolesGuard } from '../auth/guards';

/**
 * Usuarios del staff. Persisten en BD (tabla `usuario`) con espejo en memoria.
 * No importa AuthModule (que ya importa este modulo) para evitar ciclos: la
 * estrategia JWT esta registrada globalmente y RolesGuard solo usa Reflector.
 */
@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, RolesGuard],
  exports: [UsersService],
})
export class UsersModule {}
