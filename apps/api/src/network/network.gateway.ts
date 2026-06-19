import {
  OnGatewayInit,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { config } from '../config';
import { NetworkService } from './network.service';

/**
 * Gateway de tiempo real del mapa. Emite el estado de los nodos y métricas
 * cada pocos segundos para el indicador "En vivo". Exige JWT en el handshake.
 */
@WebSocketGateway({
  cors: { origin: config.corsOrigin, credentials: true },
  namespace: '/realtime',
})
export class NetworkGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('NetworkGateway');
  private tickSeed = 0;

  constructor(
    private readonly net: NetworkService,
    private readonly jwt: JwtService,
  ) {}

  afterInit() {
    setInterval(() => {
      this.tickSeed += 1;
      const nodes = this.net.tick(this.tickSeed);
      const stats = this.net.getStats();
      this.server.emit('nodes:update', nodes);
      this.server.emit('stats:update', stats);
    }, 3000);
    this.logger.log('Gateway de tiempo real iniciado (/realtime)');
  }

  handleConnection(client: Socket) {
    const token =
      client.handshake.auth?.token ||
      (client.handshake.headers.authorization || '').replace('Bearer ', '');
    try {
      this.jwt.verify(token, { secret: config.jwt.accessSecret });
    } catch {
      this.logger.warn('Conexión rechazada: token inválido');
      client.emit('unauthorized', { message: 'Token inválido' });
      client.disconnect(true);
      return;
    }
    // Estado inicial inmediato al conectar.
    client.emit('nodes:update', this.net.getNodes());
    client.emit('stats:update', this.net.getStats());
  }
}
