import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as socket_io;

/// Cliente WebSocket de la app CICANET. Se conecta al namespace `/realtime`
/// del backend con JWT y expone el estado de conexión + eventos del servicio.
/// Reconexión automática con backoff (manejada por socket.io).
class CicanetSocketClient {
  CicanetSocketClient({required this.baseUrl, required this.tokenProvider});

  /// URL del realtime, ej: `http://localhost:4000/realtime`.
  final String baseUrl;

  /// Obtiene el JWT actual (permite refresco en reconexión).
  final Future<String?> Function() tokenProvider;

  socket_io.Socket? _socket;
  final _connectionController = StreamController<bool>.broadcast();
  final _serviceController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<bool> get onConnectionChange => _connectionController.stream;

  /// Cambios de estado del servicio del cliente (activo/suspendido/cortado).
  Stream<Map<String, dynamic>> get onServiceUpdate => _serviceController.stream;

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    if (_socket != null) {
      if (!_socket!.connected) _socket!.connect();
      return;
    }
    final token = await tokenProvider();
    final socket = socket_io.io(
      baseUrl,
      socket_io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .disableAutoConnect()
          .setAuth({'token': token ?? ''})
          .setReconnectionAttempts(0xFFFFFF)
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(30000)
          .build(),
    );

    socket
      ..on('connect', (_) => _connectionController.add(true))
      ..on('disconnect', (_) => _connectionController.add(false))
      ..on('connect_error', (_) => _connectionController.add(false))
      ..onReconnectAttempt((_) async {
        final fresh = await tokenProvider();
        socket.auth = {'token': fresh ?? ''};
      })
      ..on('servicio:estado', (data) {
        if (data is Map) {
          _serviceController.add(data.map((k, v) => MapEntry(k.toString(), v)));
        }
      });

    _socket = socket;
    socket.connect();
  }

  Future<void> dispose() async {
    _socket?.dispose();
    _socket = null;
    await _connectionController.close();
    await _serviceController.close();
  }
}
