import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { config } from '../../config';
import { UsersService, User } from '../users/users.service';
import { ClientesService } from '../../crm/clientes/clientes.service';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly clientes: ClientesService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    // 1) Staff (admin/operador/técnico).
    const user = await this.users.validate(username, password);
    if (user) return this.issueTokens(user);
    // 2) Cliente (login por documento; clave inicial = documento).
    const cliente = await this.clientes.verifyCliente(username, password);
    if (cliente) return this.issueClientTokens(cliente);
    throw new UnauthorizedException('Usuario o contraseña incorrectos');
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
    if (payload.role === 'cliente') {
      const c = await this.clientes.verifyClienteById(payload.sub);
      if (!c) throw new UnauthorizedException('Cliente no existe');
      return this.issueClientTokens(c);
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

  private async issueClientTokens(c: { id: string; documento: string; nombre: string; codigo: string }) {
    const base = { sub: c.id, username: c.documento, role: 'cliente', nombre: c.nombre, clienteId: c.id };
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
    return {
      accessToken,
      refreshToken,
      user: { id: c.id, username: c.documento, nombre: c.nombre, email: '', role: 'cliente', codigo: c.codigo },
    };
  }
}
