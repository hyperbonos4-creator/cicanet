import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';

/// Datos del checkout devueltos por el backend (Wompi).
class CheckoutData {
  const CheckoutData({
    required this.referencia,
    required this.checkoutUrl,
    required this.montoCents,
    required this.moneda,
  });

  final String referencia;
  final String checkoutUrl;
  final int montoCents;
  final String moneda;

  factory CheckoutData.fromJson(Map<String, dynamic> j) => CheckoutData(
        referencia: j['referencia'] as String,
        checkoutUrl: j['checkoutUrl'] as String,
        montoCents: (j['montoCents'] as num).toInt(),
        moneda: (j['moneda'] ?? 'COP').toString(),
      );
}

class ManualInfo {
  const ManualInfo({this.nequi, this.bancolombia, this.titular});
  final String? nequi;
  final String? bancolombia;
  final String? titular;
  factory ManualInfo.fromJson(Map<String, dynamic> j) => ManualInfo(
        nequi: j['nequi']?.toString(),
        bancolombia: j['bancolombia']?.toString(),
        titular: j['titular']?.toString(),
      );
}

class PagosApi {
  PagosApi(this._dio);
  final Dio _dio;

  Future<CheckoutData> checkout({int? montoCents, String? facturaId, String? descripcion, String? email}) async {
    final res = await _dio.post('/payments/checkout', data: {
      if (montoCents != null) 'montoCents': montoCents,
      if (facturaId != null) 'facturaId': facturaId,
      if (descripcion != null) 'descripcion': descripcion,
      if (email != null) 'email': email,
    });
    return CheckoutData.fromJson(res.data as Map<String, dynamic>);
  }

  /// Devuelve el estado: CREADA | PENDIENTE | APROBADA | RECHAZADA | ANULADA.
  Future<String> status(String referencia) async {
    final res = await _dio.get('/payments/${Uri.encodeComponent(referencia)}');
    return (res.data['estado'] ?? 'PENDIENTE').toString();
  }

  Future<ManualInfo> manualInfo() async {
    final res = await _dio.get('/payments/manual-info');
    return ManualInfo.fromJson(res.data as Map<String, dynamic>);
  }
}

final pagosApiProvider = Provider<PagosApi>((ref) => PagosApi(ref.watch(dioProvider)));
