import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { UsersService, User } from '../users/users.service';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users.validate(username, password);
    if (!user) throw new UnauthorizedException('Usuario o contraseña incorrectos');
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: config.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token no es de refresco');
    }
    const user = this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Usuario no existe');
    return this.issueTokens(user);
  }

  private async issueTokens(user: User) {
    const base = { sub: user.id, username: user.username, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...base, type: 'access' },
        { secret: config.jwt.accessSecret, expiresIn: config.jwt.accessTtl },
      ),
      this.jwt.signAsync(
        { ...base, type: 'refresh' },
        { secret: config.jwt.refreshSecret, expiresIn: config.jwt.refreshTtl },
      ),
    ]);
    return { accessToken, refreshToken, user: this.users.publicView(user) };
  }
}
