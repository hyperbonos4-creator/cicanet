import 'dart:async';

import 'package:dio/dio.dart';
import 'package:cicanet_mobile/core/storage/secure_storage.dart';

/// Cliente HTTP de la app CICANET.
///
/// - Adjunta `Authorization: Bearer <accessToken>` en cada request.
/// - Ante un 401 intenta refrescar el token UNA vez y reintenta el request.
/// - Coalesce de refresh concurrentes: si varios requests chocan en 401, solo
///   el primero llama a `POST /auth/refresh`; los demás reusan el resultado.
///
/// Contrato de CICANET (NestJS): respuestas en camelCase
/// (`accessToken`, `refreshToken`), prefijo global `/api`.
class DioClient {
  late final Dio _dio;
  final SecureStorageService _storage;
  Future<bool>? _refreshFuture;

  // Sobrescribe en runtime con:
  //   --dart-define=API_BASE_URL=http://192.168.1.X:4000/api
  // Android emulator: usar 10.0.2.2; dispositivo físico USB: `adb reverse tcp:4000 tcp:4000`.
  static const String _defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000/api',
  );

  DioClient({required SecureStorageService storage, String? baseUrl})
      : _storage = storage {
    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl ?? _defaultBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        // Generoso: el asistente IA (Qwen3 local) puede tardar en responder.
        receiveTimeout: const Duration(seconds: 120),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _storage.getAccessToken();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final status = error.response?.statusCode;
          final path = error.requestOptions.path;
          final isRetry = error.requestOptions.extra['_isRetry'] == true;
          final isRefreshCall = path.endsWith('/auth/refresh');
          if (status != 401 || isRetry || isRefreshCall) {
            handler.next(error);
            return;
          }

          final refreshed = await _refreshAccessToken();
          if (refreshed) {
            try {
              final retry = await _retry(error.requestOptions);
              return handler.resolve(retry);
            } catch (e) {
              if (e is DioException) return handler.next(e);
              return handler.next(error);
            }
          }
          await _storage.clearAll();
          handler.next(error);
        },
      ),
    );
  }

  Dio get dio => _dio;

  Future<bool> _refreshAccessToken() {
    final inFlight = _refreshFuture;
    if (inFlight != null) return inFlight;
    final completer = Completer<bool>();
    _refreshFuture = completer.future;

    () async {
      try {
        final refreshToken = await _storage.getRefreshToken();
        if (refreshToken == null) {
          completer.complete(false);
          return;
        }
        final raw = Dio(BaseOptions(
          baseUrl: _dio.options.baseUrl,
          headers: {'Content-Type': 'application/json'},
        ));
        final res = await raw.post('/auth/refresh', data: {'refreshToken': refreshToken});
        final data = res.data as Map<String, dynamic>?;
        final newAccess = data?['accessToken'] as String?;
        if (newAccess == null) {
          completer.complete(false);
          return;
        }
        await _storage.saveAccessToken(newAccess);
        final newRefresh = data?['refreshToken'] as String?;
        if (newRefresh != null) await _storage.saveRefreshToken(newRefresh);
        completer.complete(true);
      } catch (_) {
        completer.complete(false);
      } finally {
        _refreshFuture = null;
      }
    }();

    return completer.future;
  }

  Future<Response<dynamic>> _retry(RequestOptions options) async {
    final token = await _storage.getAccessToken();
    final newOptions = options.copyWith(extra: {...options.extra, '_isRetry': true});
    if (token != null) newOptions.headers['Authorization'] = 'Bearer $token';
    return _dio.fetch(newOptions);
  }
}
