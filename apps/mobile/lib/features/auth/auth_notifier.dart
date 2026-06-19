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
      final msg = (e.response?.data is Map) ? (e.response?.data['message']?.toString()) : null;
      state = state.copyWith(loading: false, status: AuthStatus.unauthenticated, error: msg ?? 'Usuario o contraseña incorrectos');
      return false;
    } catch (_) {
      state = state.copyWith(loading: false, status: AuthStatus.unauthenticated, error: 'No se pudo conectar con el servidor');
      return false;
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
