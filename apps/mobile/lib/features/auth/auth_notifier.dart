import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';
import 'package:cicanet_mobile/core/storage/secure_storage.dart';

/// Usuario de sesión (vista pública que devuelve el backend de CICANET).
class SessionUser {
  const SessionUser({required this.id, required this.username, required this.nombre, required this.email, required this.role});

  final String id;
  final String username;
  final String nombre;
  final String email;
  final String role;

  factory SessionUser.fromJson(Map<String, dynamic> j) => SessionUser(
        id: (j['id'] ?? '').toString(),
        username: (j['username'] ?? '').toString(),
        nombre: (j['nombre'] ?? j['username'] ?? '').toString(),
        email: (j['email'] ?? '').toString(),
        role: (j['role'] ?? '').toString(),
      );
}

/// Estado de autenticación.
enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({this.status = AuthStatus.unknown, this.user, this.error, this.loading = false});

  final AuthStatus status;
  final SessionUser? user;
  final String? error;
  final bool loading;

  AuthState copyWith({AuthStatus? status, SessionUser? user, String? error, bool? loading}) =>
      AuthState(status: status ?? this.status, user: user ?? this.user, error: error, loading: loading ?? this.loading);
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._dio, this._storage) : super(const AuthState()) {
    _bootstrap();
  }

  final Dio _dio;
  final SecureStorageService _storage;

  /// Al arrancar: si hay token, intenta recuperar el usuario (`/auth/me`).
  Future<void> _bootstrap() async {
    final hasToken = await _storage.hasTokens();
    if (!hasToken) {
      state = state.copyWith(status: AuthStatus.unauthenticated);
      return;
    }
    try {
      final res = await _dio.get('/auth/me');
      state = state.copyWith(status: AuthStatus.authenticated, user: SessionUser.fromJson(res.data as Map<String, dynamic>));
    } catch (_) {
      await _storage.clearAll();
      state = state.copyWith(status: AuthStatus.unauthenticated);
    }
  }

  Future<bool> login(String username, String password) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final res = await _dio.post('/auth/login', data: {'username': username.trim(), 'password': password});
      final data = res.data as Map<String, dynamic>;
      await _storage.saveAccessToken(data['accessToken'] as String);
      await _storage.saveRefreshToken(data['refreshToken'] as String);
      final user = SessionUser.fromJson(data['user'] as Map<String, dynamic>);
      state = AuthState(status: AuthStatus.authenticated, user: user);
      return true;
    } on DioException catch (e) {
      state = state.copyWith(loading: false, status: AuthStatus.unauthenticated, error: _describeError(e));
      return false;
    } catch (_) {
      state = state.copyWith(loading: false, status: AuthStatus.unauthenticated, error: 'No se pudo conectar con el servidor');
      return false;
    }
  }

  /// Traduce un error de Dio a un mensaje útil para el usuario.
  ///
  /// Clave: solo un 401/403 con respuesta del backend significa
  /// "credenciales incorrectas". Si NO hubo respuesta (timeout, DNS,
  /// conexión rechazada, TLS) es un problema de RED, no de la clave; mostrarlo
  /// como tal evita el diagnóstico engañoso.
  String _describeError(DioException e) {
    final res = e.response;
    if (res != null) {
      final status = res.statusCode;
      final msg = (res.data is Map) ? (res.data['message']?.toString()) : null;
      if (status == 401 || status == 403) {
        return msg ?? 'Usuario o contraseña incorrectos';
      }
      return msg ?? 'El servidor respondió con un error ($status).';
    }
    // Sin respuesta del servidor => problema de conexión, no de credenciales.
    final url = e.requestOptions.uri.toString();
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'No hubo respuesta del servidor (timeout).\n$url';
      case DioExceptionType.connectionError:
      case DioExceptionType.badCertificate:
        return 'No se pudo conectar con el servidor.\nVerifica tu conexión y la URL:\n$url';
      default:
        return 'No se pudo conectar con el servidor.\n$url';
    }
  }

  Future<void> logout() async {
    await _storage.clearAll();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(dioProvider), ref.watch(secureStorageProvider));
});
