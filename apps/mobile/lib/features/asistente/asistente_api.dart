import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';

/// Acción rápida sugerida por el asistente (chip).
class CicaAccion {
  const CicaAccion({required this.id, required this.label, required this.tipo});
  final String id;
  final String label;
  final String tipo; // pagar | cobertura | whatsapp | facturas | planes
  factory CicaAccion.fromJson(Map<String, dynamic> j) => CicaAccion(
        id: (j['id'] ?? '').toString(),
        label: (j['label'] ?? '').toString(),
        tipo: (j['tipo'] ?? '').toString(),
      );
}

/// Link de pago generado por el agente.
class CicaPago {
  const CicaPago({required this.url, required this.referencia, required this.monto});
  final String url;
  final String referencia;
  final num monto;
  static CicaPago? fromJson(dynamic j) {
    if (j == null || j is! Map) return null;
    final url = j['url']?.toString();
    if (url == null || url.isEmpty) return null;
    return CicaPago(url: url, referencia: (j['referencia'] ?? '').toString(), monto: (j['monto'] ?? 0) as num);
  }
}

/// Respuesta del asistente.
class CicaReply {
  const CicaReply({required this.reply, required this.ai, required this.acciones, this.pago});
  final String reply;
  final bool ai;
  final List<CicaAccion> acciones;
  final CicaPago? pago;
  factory CicaReply.fromJson(Map<String, dynamic> j) => CicaReply(
        reply: (j['reply'] ?? '').toString(),
        ai: j['ai'] == true,
        acciones: ((j['acciones'] as List?) ?? [])
            .map((e) => CicaAccion.fromJson(e as Map<String, dynamic>))
            .toList(),
        pago: CicaPago.fromJson(j['pago']),
      );
}

class AsistenteInfo {
  const AsistenteInfo({required this.nombre, required this.ia, required this.saludo, required this.acciones});
  final String nombre;
  final bool ia;
  final String saludo;
  final List<CicaAccion> acciones;
  factory AsistenteInfo.fromJson(Map<String, dynamic> j) => AsistenteInfo(
        nombre: (j['nombre'] ?? 'Cica').toString(),
        ia: j['ia'] == true,
        saludo: (j['saludo'] ?? '').toString(),
        acciones: ((j['acciones'] as List?) ?? [])
            .map((e) => CicaAccion.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class AsistenteApi {
  AsistenteApi(this._dio);
  final Dio _dio;

  Future<AsistenteInfo> info() async {
    final res = await _dio.get('/assistant/info');
    return AsistenteInfo.fromJson(res.data as Map<String, dynamic>);
  }

  /// Envía el historial completo (cada turno {role, content}).
  Future<CicaReply> chat(List<Map<String, String>> messages) async {
    final res = await _dio.post('/assistant/chat', data: {'messages': messages});
    return CicaReply.fromJson(res.data as Map<String, dynamic>);
  }
}

final asistenteApiProvider = Provider<AsistenteApi>((ref) => AsistenteApi(ref.watch(dioProvider)));
