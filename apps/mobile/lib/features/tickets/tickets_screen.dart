import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/tickets/tickets_api.dart';

/// Estado visual de cada estado de ticket.
({Color color, String label}) _estadoInfo(String estado) {
  switch (estado) {
    case 'en_proceso':
      return (color: UDS.state.warning, label: 'En proceso');
    case 'resuelto':
      return (color: UDS.state.success, label: 'Resuelto');
    case 'cerrado':
      return (color: UDS.text.muted, label: 'Cerrado');
    default:
      return (color: UDS.state.danger, label: 'Abierto');
  }
}

const _catLabel = {
  'tecnico': 'Técnico',
  'facturacion': 'Facturación',
  'comercial': 'Comercial',
  'general': 'General',
};

/// "Mis solicitudes": tickets de soporte del cliente.
class TicketsScreen extends ConsumerStatefulWidget {
  const TicketsScreen({super.key});

  @override
  ConsumerState<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends ConsumerState<TicketsScreen> {
  late Future<List<TicketItem>> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(ticketsApiProvider).mine();
  }

  Future<void> _recargar() async {
    setState(() => _future = ref.read(ticketsApiProvider).mine());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        iconTheme: IconThemeData(color: UDS.text.primary),
        title: const Text('Mis solicitudes'),
        titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _recargar,
          color: UDS.accent.primary,
          backgroundColor: UDS.surface.raised,
          child: FutureBuilder<List<TicketItem>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(UDS.accent.primary)));
              }
              if (snap.hasError) {
                return const _Mensaje(texto: 'No se pudieron cargar tus solicitudes. Desliza para reintentar.');
              }
              final tickets = snap.data ?? [];
              if (tickets.isEmpty) {
                return const _Mensaje(
                  texto: 'Aún no tienes solicitudes. Cuando reportes algo por el asistente Cica, aparecerá aquí con su estado.',
                );
              }
              return ListView.separated(
                padding: EdgeInsets.all(UDS.space.s5),
                itemCount: tickets.length,
                separatorBuilder: (_, __) => SizedBox(height: UDS.space.s3),
                itemBuilder: (_, i) => _TicketCard(t: tickets[i]),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.t});
  final TicketItem t;

  @override
  Widget build(BuildContext context) {
    final est = _estadoInfo(t.estado);
    final fecha = t.creadoEn != null ? DateFormat('d MMM, h:mm a').format(t.creadoEn!) : '';
    return CicaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(t.codigo, style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.bold, color: UDS.accent.primary)),
              const Spacer(),
              Container(
                padding: EdgeInsets.symmetric(horizontal: UDS.space.s2, vertical: 3),
                decoration: BoxDecoration(color: est.color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
                child: Text(est.label, style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.semibold, color: est.color)),
              ),
            ],
          ),
          SizedBox(height: UDS.space.s2),
          Text(t.asunto, style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.semibold, color: UDS.text.primary)),
          const SizedBox(height: 2),
          Text(t.descripcion, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
          SizedBox(height: UDS.space.s2),
          Row(
            children: [
              Text(_catLabel[t.categoria] ?? t.categoria, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              if (fecha.isNotEmpty) ...[
                Text('  ·  ', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                Text(fecha, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _Mensaje extends StatelessWidget {
  const _Mensaje({required this.texto});
  final String texto;
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.all(UDS.space.s6),
      children: [
        SizedBox(height: UDS.space.s7),
        Icon(Icons.confirmation_number_outlined, size: 48, color: UDS.text.muted),
        SizedBox(height: UDS.space.s4),
        Text(texto, textAlign: TextAlign.center, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
      ],
    );
  }
}
