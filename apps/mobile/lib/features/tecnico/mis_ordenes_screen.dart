import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/tecnico/ordenes_api.dart';
import 'package:cicanet_mobile/features/tecnico/orden_detalle_screen.dart';

/// Metadatos visuales por estado de la orden.
({Color color, String label}) estadoInfo(String estado) {
  switch (estado) {
    case 'en_camino':
      return (color: UDS.accent.steel, label: 'En camino');
    case 'en_sitio':
      return (color: UDS.state.warning, label: 'En sitio');
    case 'completada':
      return (color: UDS.state.success, label: 'Completada');
    case 'cancelada':
      return (color: UDS.state.danger, label: 'Cancelada');
    default:
      return (color: UDS.text.dim, label: 'Asignada');
  }
}

const tipoLabel = {
  'instalacion': 'Instalación',
  'visita': 'Visita',
  'reparacion': 'Reparación',
};

({Color color, String label}) prioridadInfo(String p) {
  switch (p) {
    case 'alta':
      return (color: UDS.state.danger, label: 'Alta');
    case 'baja':
      return (color: UDS.text.dim, label: 'Baja');
    default:
      return (color: UDS.state.warning, label: 'Media');
  }
}

/// "Mis órdenes": instalaciones y visitas asignadas al técnico.
class MisOrdenesScreen extends ConsumerStatefulWidget {
  const MisOrdenesScreen({super.key});

  @override
  ConsumerState<MisOrdenesScreen> createState() => _MisOrdenesScreenState();
}

class _MisOrdenesScreenState extends ConsumerState<MisOrdenesScreen> {
  late Future<List<Orden>> _future;
  bool _soloActivas = true;

  @override
  void initState() {
    super.initState();
    _future = ref.read(ordenesApiProvider).mias();
  }

  Future<void> _recargar() async {
    setState(() => _future = ref.read(ordenesApiProvider).mias());
    await _future;
  }

  Future<void> _abrir(Orden o) async {
    final cambio = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => OrdenDetalleScreen(ordenId: o.id)),
    );
    if (cambio == true) _recargar();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        title: const Text('Mis órdenes'),
        titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
        actions: [
          IconButton(
            tooltip: _soloActivas ? 'Ver todas' : 'Ver solo activas',
            icon: Icon(_soloActivas ? Icons.filter_alt : Icons.filter_alt_off, color: UDS.text.dim),
            onPressed: () => setState(() => _soloActivas = !_soloActivas),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _recargar,
          color: UDS.accent.primary,
          backgroundColor: UDS.surface.raised,
          child: FutureBuilder<List<Orden>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(UDS.accent.primary)));
              }
              if (snap.hasError) {
                return const _Mensaje(icon: Icons.cloud_off, texto: 'No se pudieron cargar tus órdenes. Desliza para reintentar.');
              }
              var ordenes = snap.data ?? [];
              if (_soloActivas) ordenes = ordenes.where((o) => o.activa).toList();
              if (ordenes.isEmpty) {
                return _Mensaje(
                  icon: Icons.assignment_turned_in_outlined,
                  texto: _soloActivas
                      ? 'No tienes órdenes activas. Cuando el administrador te asigne una instalación, aparecerá aquí.'
                      : 'Aún no tienes órdenes asignadas.',
                );
              }
              return ListView.separated(
                padding: EdgeInsets.all(UDS.space.s5),
                itemCount: ordenes.length,
                separatorBuilder: (_, __) => SizedBox(height: UDS.space.s3),
                itemBuilder: (_, i) => _OrdenCard(o: ordenes[i], onTap: () => _abrir(ordenes[i])),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _OrdenCard extends StatelessWidget {
  const _OrdenCard({required this.o, required this.onTap});
  final Orden o;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final est = estadoInfo(o.estado);
    final prio = prioridadInfo(o.prioridad);
    final fecha = o.fechaProgramada != null ? DateFormat('EEE d MMM, h:mm a', 'es_CO').format(o.fechaProgramada!) : null;

    return CicaCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(o.codigo, style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.bold, color: UDS.accent.primary)),
              SizedBox(width: UDS.space.s2),
              Text(tipoLabel[o.tipo] ?? o.tipo, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              const Spacer(),
              Container(
                padding: EdgeInsets.symmetric(horizontal: UDS.space.s2, vertical: 3),
                decoration: BoxDecoration(color: est.color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
                child: Text(est.label, style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.semibold, color: est.color)),
              ),
            ],
          ),
          SizedBox(height: UDS.space.s2),
          Text(o.titulo, style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.semibold, color: UDS.text.primary)),
          const SizedBox(height: 2),
          Row(
            children: [
              Icon(Icons.location_on_outlined, size: 14, color: UDS.text.muted),
              const SizedBox(width: 4),
              Expanded(child: Text(o.direccion, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim))),
            ],
          ),
          if (o.clienteNombre != null && o.clienteNombre!.isNotEmpty) ...[
            const SizedBox(height: 2),
            Row(
              children: [
                Icon(Icons.person_outline, size: 14, color: UDS.text.muted),
                const SizedBox(width: 4),
                Text(o.clienteNombre!, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
              ],
            ),
          ],
          SizedBox(height: UDS.space.s2),
          Row(
            children: [
              Container(
                padding: EdgeInsets.symmetric(horizontal: UDS.space.s2, vertical: 2),
                decoration: BoxDecoration(color: prio.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(6)),
                child: Text('Prioridad ${prio.label}', style: TextStyle(fontSize: UDS.font.size.sxs, color: prio.color)),
              ),
              if (fecha != null) ...[
                SizedBox(width: UDS.space.s2),
                Icon(Icons.schedule, size: 13, color: UDS.text.muted),
                const SizedBox(width: 3),
                Flexible(child: Text(fecha, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted))),
              ],
              if (o.fotos.isNotEmpty) ...[
                const Spacer(),
                Icon(Icons.photo_camera_outlined, size: 13, color: UDS.text.muted),
                const SizedBox(width: 3),
                Text('${o.fotos.length}', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _Mensaje extends StatelessWidget {
  const _Mensaje({required this.texto, required this.icon});
  final String texto;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.all(UDS.space.s6),
      children: [
        SizedBox(height: UDS.space.s8),
        Icon(icon, size: 52, color: UDS.text.muted),
        SizedBox(height: UDS.space.s4),
        Text(texto, textAlign: TextAlign.center, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
      ],
    );
  }
}
