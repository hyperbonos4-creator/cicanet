import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:cicanet_mobile/core/api/api_providers.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/tecnico/ordenes_api.dart';
import 'package:cicanet_mobile/features/tecnico/mis_ordenes_screen.dart' show estadoInfo, tipoLabel;

/// Detalle de una orden de trabajo del técnico. Permite avanzar el estado,
/// abrir la ubicación en el mapa, tomar fotos de evidencia con la cámara y
/// completar la orden con notas.
class OrdenDetalleScreen extends ConsumerStatefulWidget {
  const OrdenDetalleScreen({super.key, required this.ordenId});
  final String ordenId;

  @override
  ConsumerState<OrdenDetalleScreen> createState() => _OrdenDetalleScreenState();
}

class _OrdenDetalleScreenState extends ConsumerState<OrdenDetalleScreen> {
  Orden? _orden;
  bool _cargando = true;
  bool _trabajando = false;
  bool _cambios = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    try {
      final o = await ref.read(ordenesApiProvider).getOne(widget.ordenId);
      if (mounted) setState(() { _orden = o; _cargando = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _cargando = false; _error = 'No se pudo cargar la orden.'; });
    }
  }

  void _aviso(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: error ? UDS.state.danger : UDS.surface.raised),
    );
  }

  Future<void> _cambiarEstado(String estado) async {
    setState(() => _trabajando = true);
    try {
      final o = await ref.read(ordenesApiProvider).cambiarEstado(widget.ordenId, estado);
      setState(() { _orden = o; _cambios = true; });
      _aviso('Estado actualizado: ${estadoInfo(estado).label}');
    } catch (e) {
      _aviso('No se pudo actualizar el estado.', error: true);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _tomarFoto() async {
    final picker = ImagePicker();
    final XFile? shot = await picker.pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 1600);
    if (shot == null) return;
    final nota = await _pedirNota();
    setState(() => _trabajando = true);
    try {
      await ref.read(ordenesApiProvider).subirFoto(widget.ordenId, shot.path, nota: nota);
      await _cargar();
      setState(() => _cambios = true);
      _aviso('Evidencia subida.');
    } catch (e) {
      _aviso('No se pudo subir la foto.', error: true);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<String?> _pedirNota() async {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: UDS.surface.raised,
        title: Text('Nota de la foto', style: TextStyle(color: UDS.text.primary, fontSize: UDS.font.size.smd)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          style: TextStyle(color: UDS.text.primary),
          decoration: InputDecoration(hintText: 'Opcional (ej: caja NAP, acometida…)', hintStyle: TextStyle(color: UDS.text.muted)),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, ''), child: const Text('Sin nota')),
          TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Guardar')),
        ],
      ),
    );
  }

  Future<void> _completar() async {
    final ctrl = TextEditingController(text: _orden?.notasTecnico ?? '');
    final notas = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: UDS.surface.raised,
        title: Text('Completar orden', style: TextStyle(color: UDS.text.primary, fontSize: UDS.font.size.smd)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Confirma que el trabajo quedó terminado. Añade notas del cierre.',
                style: TextStyle(color: UDS.text.dim, fontSize: UDS.font.size.ssm)),
            SizedBox(height: UDS.space.s3),
            TextField(
              controller: ctrl,
              maxLines: 3,
              style: TextStyle(color: UDS.text.primary),
              decoration: InputDecoration(hintText: 'Ej: ONU activada, potencia -19 dBm…', hintStyle: TextStyle(color: UDS.text.muted)),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Completar')),
        ],
      ),
    );
    if (notas == null) return;
    setState(() => _trabajando = true);
    try {
      final o = await ref.read(ordenesApiProvider).completar(widget.ordenId, notas: notas.isEmpty ? null : notas);
      setState(() { _orden = o; _cambios = true; });
      _aviso('Orden completada. ¡Buen trabajo!');
    } catch (e) {
      _aviso('No se pudo completar la orden.', error: true);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _abrirMapa() async {
    final o = _orden;
    if (o == null) return;
    final Uri uri = (o.lat != null && o.lng != null)
        ? Uri.parse('https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}')
        : Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(o.direccion)}');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  String _origin() {
    final base = ref.read(dioProvider).options.baseUrl;
    return base.replaceAll(RegExp(r'/api/?$'), '');
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (didPop, _) {},
      child: Scaffold(
        backgroundColor: UDS.surface.base,
        appBar: AppBar(
          backgroundColor: UDS.surface.base,
          iconTheme: IconThemeData(color: UDS.text.primary),
          title: Text(_orden?.codigo ?? 'Orden'),
          titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
          leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.pop(context, _cambios)),
        ),
        body: SafeArea(
          child: _cargando
              ? Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(UDS.accent.primary)))
              : _error != null
                  ? Center(child: Text(_error!, style: TextStyle(color: UDS.text.dim)))
                  : _contenido(_orden!),
        ),
      ),
    );
  }

  Widget _contenido(Orden o) {
    final est = estadoInfo(o.estado);
    final origin = _origin();
    final fecha = o.fechaProgramada != null ? DateFormat('EEEE d MMMM, h:mm a', 'es_CO').format(o.fechaProgramada!) : 'Sin programar';

    return Stack(
      children: [
        ListView(
          padding: EdgeInsets.all(UDS.space.s5),
          children: [
            // Encabezado
            Row(
              children: [
                Expanded(child: Text(o.titulo, style: TextStyle(fontSize: UDS.font.size.sxl, fontWeight: UDS.font.weight.bold, color: UDS.text.primary))),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: UDS.space.s3, vertical: 5),
                  decoration: BoxDecoration(color: est.color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
                  child: Text(est.label, style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.bold, color: est.color)),
                ),
              ],
            ),
            SizedBox(height: UDS.space.s2),
            Text('${tipoLabel[o.tipo] ?? o.tipo} · Prioridad ${o.prioridad}', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            SizedBox(height: UDS.space.s4),

            // Datos
            CicaCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _fila(Icons.location_on_outlined, 'Dirección', o.direccion),
                  if (o.clienteNombre != null && o.clienteNombre!.isNotEmpty) ...[
                    Divider(height: UDS.space.s5, color: UDS.border.subtle),
                    _fila(Icons.person_outline, 'Cliente', o.clienteNombre!),
                  ],
                  if (o.contacto != null && o.contacto!.isNotEmpty) ...[
                    Divider(height: UDS.space.s5, color: UDS.border.subtle),
                    _fila(Icons.phone_outlined, 'Contacto', o.contacto!),
                  ],
                  Divider(height: UDS.space.s5, color: UDS.border.subtle),
                  _fila(Icons.schedule, 'Programada', fecha),
                  if (o.descripcion != null && o.descripcion!.isNotEmpty) ...[
                    Divider(height: UDS.space.s5, color: UDS.border.subtle),
                    _fila(Icons.notes, 'Instrucciones', o.descripcion!),
                  ],
                ],
              ),
            ),
            SizedBox(height: UDS.space.s3),

            // Botón mapa
            CicaButton(
              label: 'Ver ubicación en el mapa',
              variant: CicaButtonVariant.secondary,
              fullWidth: true,
              leftIcon: Icons.map_outlined,
              onPressed: _abrirMapa,
            ),
            SizedBox(height: UDS.space.s5),

            // Evidencia
            Row(
              children: [
                Text('Evidencia fotográfica', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                const Spacer(),
                Text('${o.fotos.length} foto(s)', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              ],
            ),
            SizedBox(height: UDS.space.s3),
            if (o.fotos.isEmpty)
              Text('Aún no hay fotos. Toma una con la cámara al instalar.', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim))
            else
              Wrap(
                spacing: UDS.space.s2,
                runSpacing: UDS.space.s2,
                children: o.fotos.map((f) => _miniatura(origin + f.url, f.nota)).toList(),
              ),
            SizedBox(height: UDS.space.s3),
            if (o.activa)
              CicaButton(
                label: 'Tomar foto de evidencia',
                variant: CicaButtonVariant.secondary,
                fullWidth: true,
                leftIcon: Icons.photo_camera_outlined,
                onPressed: _trabajando ? null : _tomarFoto,
              ),

            if (o.notasTecnico != null && o.notasTecnico!.isNotEmpty) ...[
              SizedBox(height: UDS.space.s5),
              Text('Notas de cierre', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
              SizedBox(height: UDS.space.s2),
              Text(o.notasTecnico!, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            ],

            SizedBox(height: UDS.space.s8),
            SizedBox(height: UDS.space.s7), // espacio para la barra de acción
          ],
        ),

        // Barra de acción inferior (avanzar estado / completar)
        if (o.activa)
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: _barraAccion(o),
          ),
      ],
    );
  }

  Widget _barraAccion(Orden o) {
    final siguiente = _siguienteEstado(o.estado);
    return Container(
      padding: EdgeInsets.fromLTRB(UDS.space.s5, UDS.space.s3, UDS.space.s5, UDS.space.s5),
      decoration: BoxDecoration(
        color: UDS.surface.raised,
        border: Border(top: BorderSide(color: UDS.border.subtle)),
      ),
      child: Row(
        children: [
          if (siguiente != null)
            Expanded(
              child: CicaButton(
                label: siguiente.label,
                leftIcon: siguiente.icon,
                fullWidth: true,
                loading: _trabajando,
                onPressed: _trabajando ? null : () => _cambiarEstado(siguiente.estado),
              ),
            ),
          if (o.estado == 'en_sitio') ...[
            if (siguiente != null) SizedBox(width: UDS.space.s2),
            Expanded(
              child: CicaButton(
                label: 'Completar',
                leftIcon: Icons.check_circle_outline,
                fullWidth: true,
                loading: _trabajando,
                onPressed: _trabajando ? null : _completar,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Próximo estado del flujo y su etiqueta de botón.
  ({String estado, String label, IconData icon})? _siguienteEstado(String actual) {
    switch (actual) {
      case 'asignada':
        return (estado: 'en_camino', label: 'Voy en camino', icon: Icons.directions_car_outlined);
      case 'en_camino':
        return (estado: 'en_sitio', label: 'Llegué al sitio', icon: Icons.location_on_outlined);
      case 'en_sitio':
        return null; // el botón Completar cubre este caso
      default:
        return null;
    }
  }

  Widget _fila(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: UDS.text.muted),
        SizedBox(width: UDS.space.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              const SizedBox(height: 1),
              Text(value, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.primary)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _miniatura(String url, String? nota) {
    return GestureDetector(
      onTap: () => _verFoto(url, nota),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(UDS.radius.sm),
        child: Image.network(
          url,
          width: 96, height: 96, fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Container(
            width: 96, height: 96, color: UDS.surface.sunken,
            child: Icon(Icons.broken_image_outlined, color: UDS.text.muted),
          ),
          loadingBuilder: (ctx, child, prog) => prog == null
              ? child
              : Container(width: 96, height: 96, color: UDS.surface.sunken, child: Center(child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(UDS.accent.primary)))),
        ),
      ),
    );
  }

  void _verFoto(String url, String? nota) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: UDS.surface.raised,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            InteractiveViewer(child: Image.network(url)),
            if (nota != null && nota.isNotEmpty)
              Padding(
                padding: EdgeInsets.all(UDS.space.s3),
                child: Text(nota, style: TextStyle(color: UDS.text.dim, fontSize: UDS.font.size.ssm)),
              ),
          ],
        ),
      ),
    );
  }
}
