import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';

/// Configuración del canal de soporte por WhatsApp (definida por el admin).
class SoporteWhatsapp {
  const SoporteWhatsapp({
    required this.numero,
    required this.numeroFormateado,
    required this.mensaje,
    required this.habilitado,
    required this.url,
  });

  final String numero;
  final String numeroFormateado;
  final String mensaje;
  final bool habilitado;

  /// Deep link wa.me listo para abrir (null si soporte está deshabilitado).
  final String? url;

  factory SoporteWhatsapp.fromJson(Map<String, dynamic> j) => SoporteWhatsapp(
        numero: (j['numero'] ?? '').toString(),
        numeroFormateado: (j['numeroFormateado'] ?? '').toString(),
        mensaje: (j['mensaje'] ?? '').toString(),
        habilitado: j['habilitado'] == true,
        url: (j['url'] as String?)?.isNotEmpty == true ? j['url'] as String : null,
      );
}

class SoporteApi {
  SoporteApi(this._dio);
  final Dio _dio;

  Future<SoporteWhatsapp> whatsapp() async {
    final res = await _dio.get('/whatsapp/contact');
    return SoporteWhatsapp.fromJson(res.data as Map<String, dynamic>);
  }
}

final soporteApiProvider = Provider<SoporteApi>((ref) => SoporteApi(ref.watch(dioProvider)));
