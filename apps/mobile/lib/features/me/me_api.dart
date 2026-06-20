import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';

/// Estado del servicio del cliente autenticado.
class MiServicio {
  const MiServicio({
    required this.plan,
    required this.estadoServicio,
    required this.activo,
    required this.velocidadBajada,
    required this.velocidadSubida,
    required this.tarifa,
    required this.saldo,
    required this.diaCorte,
    required this.direccion,
  });

  final String plan;
  final String estadoServicio;
  final bool activo;
  final int? velocidadBajada;
  final int? velocidadSubida;
  final num tarifa;
  final num saldo;
  final int? diaCorte;
  final String? direccion;

  factory MiServicio.fromJson(Map<String, dynamic> j) => MiServicio(
        plan: (j['plan'] ?? '—').toString(),
        estadoServicio: (j['estadoServicio'] ?? '').toString(),
        activo: j['activo'] == true,
        velocidadBajada: (j['velocidadBajada'] as num?)?.toInt(),
        velocidadSubida: (j['velocidadSubida'] as num?)?.toInt(),
        tarifa: (j['tarifa'] ?? 0) as num,
        saldo: (j['saldo'] ?? 0) as num,
        diaCorte: (j['diaCorte'] as num?)?.toInt(),
        direccion: j['direccion']?.toString(),
      );
}

/// Factura del cliente.
class MiFactura {
  const MiFactura({
    required this.id,
    required this.periodo,
    required this.total,
    required this.estado,
    required this.pagada,
    required this.fechaVencimiento,
  });

  final String id;
  final String periodo;
  final num total;
  final String estado;
  final bool pagada;
  final String? fechaVencimiento;

  factory MiFactura.fromJson(Map<String, dynamic> j) => MiFactura(
        id: (j['id'] ?? '').toString(),
        periodo: (j['periodo'] ?? '').toString(),
        total: (j['total'] ?? 0) as num,
        estado: (j['estado'] ?? '').toString(),
        pagada: j['pagada'] == true,
        fechaVencimiento: j['fechaVencimiento']?.toString(),
      );
}

class MeApi {
  MeApi(this._dio);
  final Dio _dio;

  Future<MiServicio> servicio() async {
    final res = await _dio.get('/me/servicio');
    return MiServicio.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<MiFactura>> facturas() async {
    final res = await _dio.get('/me/facturas');
    final list = (res.data as List?) ?? [];
    return list.map((e) => MiFactura.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final meApiProvider = Provider<MeApi>((ref) => MeApi(ref.watch(dioProvider)));
