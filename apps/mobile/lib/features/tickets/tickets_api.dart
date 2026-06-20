import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/api/api_providers.dart';

/// Ticket de soporte del cliente.
class TicketItem {
  const TicketItem({
    required this.codigo,
    required this.asunto,
    required this.descripcion,
    required this.categoria,
    required this.estado,
    required this.creadoEn,
  });

  final String codigo;
  final String asunto;
  final String descripcion;
  final String categoria;
  final String estado; // abierto | en_proceso | resuelto | cerrado
  final DateTime? creadoEn;

  factory TicketItem.fromJson(Map<String, dynamic> j) => TicketItem(
        codigo: (j['codigo'] ?? '').toString(),
        asunto: (j['asunto'] ?? '').toString(),
        descripcion: (j['descripcion'] ?? '').toString(),
        categoria: (j['categoria'] ?? 'general').toString(),
        estado: (j['estado'] ?? 'abierto').toString(),
        creadoEn: DateTime.tryParse((j['creadoEn'] ?? '').toString()),
      );
}

class TicketsApi {
  TicketsApi(this._dio);
  final Dio _dio;

  Future<List<TicketItem>> mine() async {
    final res = await _dio.get('/tickets/mine');
    final list = (res.data as List?) ?? [];
    return list.map((e) => TicketItem.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final ticketsApiProvider = Provider<TicketsApi>((ref) => TicketsApi(ref.watch(dioProvider)));
