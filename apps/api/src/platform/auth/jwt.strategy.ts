import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { config } from '../../config';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  nombre?: string;
  clienteId?: string;
  type?: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('Token de refresco no válido para acceso');
    }
    // Cliente del portal/app: la identidad viaja en el propio token.
    if (payload.role === 'cliente') {
      return {
        id: payload.sub,
        clienteId: payload.clienteId ?? payload.sub,
        username: payload.username,
        role: 'cliente',
        nombre: payload.nombre ?? '',
      };
    }
    // Staff.
    const user = this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Usuario no existe');
    return { id: user.id, username: user.username, role: user.role, nombre: user.nombre };
  }
}
