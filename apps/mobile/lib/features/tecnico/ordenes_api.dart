import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';

/// Foto de evidencia de una orden de trabajo.
class OrdenFoto {
  const OrdenFoto({required this.id, required this.url, this.nota, this.ts});
  final String id;
  final String url;
  final String? nota;
  final DateTime? ts;

  factory OrdenFoto.fromJson(Map<String, dynamic> j) => OrdenFoto(
        id: (j['id'] ?? '').toString(),
        url: (j['url'] ?? '').toString(),
        nota: j['nota']?.toString(),
        ts: DateTime.tryParse((j['ts'] ?? '').toString()),
      );
}

/// Orden de trabajo asignada al técnico.
class Orden {
  const Orden({
    required this.id,
    required this.codigo,
    required this.tipo,
    required this.estado,
    required this.prioridad,
    required this.titulo,
    required this.direccion,
    required this.descripcion,
    required this.clienteNombre,
    required this.contacto,
    required this.lat,
    required this.lng,
    required this.fechaProgramada,
    required this.notasTecnico,
    required this.fotos,
  });

  final String id;
  final String codigo;
  final String tipo; // instalacion|visita|reparacion
  final String estado; // asignada|en_camino|en_sitio|completada|cancelada
  final String prioridad; // baja|media|alta
  final String titulo;
  final String direccion;
  final String? descripcion;
  final String? clienteNombre;
  final String? contacto;
  final double? lat;
  final double? lng;
  final DateTime? fechaProgramada;
  final String? notasTecnico;
  final List<OrdenFoto> fotos;

  factory Orden.fromJson(Map<String, dynamic> j) {
    final rawFotos = (j['fotos'] as List?) ?? [];
    return Orden(
      id: (j['id'] ?? '').toString(),
      codigo: (j['codigo'] ?? '').toString(),
      tipo: (j['tipo'] ?? 'instalacion').toString(),
      estado: (j['estado'] ?? 'asignada').toString(),
      prioridad: (j['prioridad'] ?? 'media').toString(),
      titulo: (j['titulo'] ?? '').toString(),
      direccion: (j['direccion'] ?? '').toString(),
      descripcion: j['descripcion']?.toString(),
      clienteNombre: j['clienteNombre']?.toString(),
      contacto: j['contacto']?.toString(),
      lat: (j['lat'] as num?)?.toDouble(),
      lng: (j['lng'] as num?)?.toDouble(),
      fechaProgramada: DateTime.tryParse((j['fechaProgramada'] ?? '').toString()),
      notasTecnico: j['notasTecnico']?.toString(),
      fotos: rawFotos.map((e) => OrdenFoto.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  bool get activa => estado != 'completada' && estado != 'cancelada';
}

class OrdenesApi {
  OrdenesApi(this._dio);
  final Dio _dio;

  Future<List<Orden>> mias() async {
    final res = await _dio.get('/ordenes/mias');
    final list = (res.data as List?) ?? [];
    return list.map((e) => Orden.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Orden> getOne(String id) async {
    final res = await _dio.get('/ordenes/mias/$id');
    return Orden.fromJson(res.data as Map<String, dynamic>);
  }

  Future<Orden> cambiarEstado(String id, String estado) async {
    final res = await _dio.patch('/ordenes/mias/$id/estado', data: {'estado': estado});
    return Orden.fromJson(res.data as Map<String, dynamic>);
  }

  Future<Orden> completar(String id, {String? notas}) async {
    final res = await _dio.post('/ordenes/mias/$id/completar', data: {if (notas != null) 'notas': notas});
    return Orden.fromJson(res.data as Map<String, dynamic>);
  }

  /// Sube una foto (capturada con la cámara) como evidencia multipart.
  Future<OrdenFoto> subirFoto(String id, String filePath, {String? nota}) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath),
      if (nota != null && nota.isNotEmpty) 'nota': nota,
    });
    final res = await _dio.post(
      '/ordenes/mias/$id/foto',
      data: form,
      options: Options(contentType: 'multipart/form-data'),
    );
    final data = res.data as Map<String, dynamic>;
    return OrdenFoto.fromJson(data['foto'] as Map<String, dynamic>);
  }
}

final ordenesApiProvider = Provider<OrdenesApi>((ref) => OrdenesApi(ref.watch(dioProvider)));
