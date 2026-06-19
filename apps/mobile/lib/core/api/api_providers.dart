import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/dio_client.dart';
import 'package:cicanet_mobile/core/storage/secure_storage.dart';

/// Almacenamiento seguro (singleton).
final secureStorageProvider = Provider<SecureStorageService>((ref) {
  return SecureStorageService();
});

/// Cliente HTTP con auth + refresh.
final dioClientProvider = Provider<DioClient>((ref) {
  final storage = ref.watch(secureStorageProvider);
  return DioClient(storage: storage);
});

/// Acceso directo al Dio configurado.
final dioProvider = Provider<Dio>((ref) => ref.watch(dioClientProvider).dio);
