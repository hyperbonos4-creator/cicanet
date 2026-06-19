import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/pagos/pagos_api.dart';

enum _Estado { idle, abriendo, esperando, aprobado, rechazado, error }

class PagoScreen extends ConsumerStatefulWidget {
  const PagoScreen({super.key, required this.montoCents, required this.descripcion, this.facturaId});

  final int montoCents;
  final String descripcion;
  final String? facturaId;

  @override
  ConsumerState<PagoScreen> createState() => _PagoScreenState();
}

class _PagoScreenState extends ConsumerState<PagoScreen> {
  _Estado _estado = _Estado.idle;
  String? _referencia;
  String? _error;
  Timer? _poll;

  String get _montoFmt =>
      NumberFormat.currency(locale: 'es_CO', symbol: '\$', decimalDigits: 0).format(widget.montoCents / 100);

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _pagarOnline() async {
    setState(() { _estado = _Estado.abriendo; _error = null; });
    try {
      final api = ref.read(pagosApiProvider);
      final co = await api.checkout(
        montoCents: widget.montoCents,
        facturaId: widget.facturaId,
        descripcion: widget.descripcion,
      );
      _referencia = co.referencia;
      final uri = Uri.parse(co.checkoutUrl);
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok) throw Exception('No se pudo abrir el checkout');
      setState(() => _estado = _Estado.esperando);
      _startPolling();
    } catch (e) {
      setState(() { _estado = _Estado.error; _error = 'No se pudo iniciar el pago. Intenta de nuevo.'; });
    }
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _verificar(silent: true));
  }

  Future<void> _verificar({bool silent = false}) async {
    if (_referencia == null) return;
    try {
      final estado = await ref.read(pagosApiProvider).status(_referencia!);
      if (estado == 'APROBADA') {
        _poll?.cancel();
        if (mounted) setState(() => _estado = _Estado.aprobado);
      } else if (estado == 'RECHAZADA' || estado == 'ANULADA') {
        _poll?.cancel();
        if (mounted) setState(() => _estado = _Estado.rechazado);
      }
    } catch (_) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo verificar el pago')));
      }
    }
  }

  Future<void> _transferenciaManual() async {
    try {
      final info = await ref.read(pagosApiProvider).manualInfo();
      if (!mounted) return;
      showModalBottomSheet(
        context: context,
        backgroundColor: UDS.surface.raised,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(UDS.radius.lg))),
        builder: (_) => _ManualSheet(info: info, monto: _montoFmt),
      );
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No hay datos de transferencia configurados')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        title: const Text('Pagar factura'),
        titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
        iconTheme: IconThemeData(color: UDS.text.primary),
      ),
      body: SafeArea(
        child: _estado == _Estado.aprobado
            ? _Resultado(ok: true, monto: _montoFmt, onClose: () => Navigator.of(context).pop(true))
            : _estado == _Estado.rechazado
                ? _Resultado(ok: false, monto: _montoFmt, onRetry: () => setState(() => _estado = _Estado.idle))
                : _contenido(),
      ),
    );
  }

  Widget _contenido() {
    final esperando = _estado == _Estado.esperando;
    return ListView(
      padding: EdgeInsets.all(UDS.space.s5),
      children: [
        // Tarjeta de marca + monto
        CicaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 40, height: 40,
                    decoration: BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [UDS.accent.primary, UDS.accent.primaryHover])),
                    alignment: Alignment.center,
                    child: Icon(Icons.wifi_tethering, size: 22, color: UDS.surface.base),
                  ),
                  SizedBox(width: UDS.space.s3),
                  Text('CICANET', style: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary, letterSpacing: 0.5)),
                ],
              ),
              SizedBox(height: UDS.space.s5),
              Text('Total a pagar', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
              SizedBox(height: UDS.space.s1),
              Text(_montoFmt, style: TextStyle(fontSize: UDS.font.size.s3xl, fontWeight: UDS.font.weight.bold, color: UDS.accent.primary)),
              SizedBox(height: UDS.space.s1),
              Text(widget.descripcion, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            ],
          ),
        ),
        SizedBox(height: UDS.space.s5),

        if (esperando) ...[
          CicaCard(
            child: Column(
              children: [
                Row(
                  children: [
                    SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(UDS.accent.primary))),
                    SizedBox(width: UDS.space.s3),
                    Expanded(child: Text('Esperando la confirmación del pago…', style: TextStyle(fontSize: UDS.font.size.smd, color: UDS.text.primary))),
                  ],
                ),
                SizedBox(height: UDS.space.s2),
                Text('Completa el pago en la ventana de Wompi. Esta pantalla se actualizará sola.', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
              ],
            ),
          ),
          SizedBox(height: UDS.space.s4),
          CicaButton(label: 'Ya pagué — verificar', variant: CicaButtonVariant.secondary, fullWidth: true, onPressed: () => _verificar()),
        ] else ...[
          Text('Elige cómo pagar', style: TextStyle(fontSize: UDS.font.size.ssm, fontWeight: UDS.font.weight.semibold, color: UDS.text.dim)),
          SizedBox(height: UDS.space.s3),
          // Pago en línea (Wompi: PSE, Nequi, tarjetas)
          CicaCard(
            onTap: _estado == _Estado.abriendo ? null : _pagarOnline,
            child: Row(
              children: [
                Icon(Icons.bolt, color: UDS.accent.primary, size: 28),
                SizedBox(width: UDS.space.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Pagar en línea', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                      SizedBox(height: 2),
                      Text('PSE · Nequi · Tarjeta · Bancolombia', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim)),
                    ],
                  ),
                ),
                if (_estado == _Estado.abriendo)
                  SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(UDS.accent.primary)))
                else
                  Icon(Icons.chevron_right, color: UDS.text.muted),
              ],
            ),
          ),
          SizedBox(height: UDS.space.s3),
          // Transferencia manual (Nequi / Bancolombia de la empresa)
          CicaCard(
            elevation: CicaCardElevation.flat,
            onTap: _transferenciaManual,
            child: Row(
              children: [
                Icon(Icons.account_balance_wallet_outlined, color: UDS.text.dim, size: 26),
                SizedBox(width: UDS.space.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Transferencia manual', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.semibold, color: UDS.text.primary)),
                      SizedBox(height: 2),
                      Text('Envía a la cuenta Nequi/Bancolombia de CICANET', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim)),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right, color: UDS.text.muted),
              ],
            ),
          ),
          if (_error != null) ...[
            SizedBox(height: UDS.space.s4),
            Text(_error!, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.state.danger)),
          ],
          SizedBox(height: UDS.space.s6),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.lock_outline, size: 13, color: UDS.text.muted),
              SizedBox(width: 6),
              Text('Pago seguro procesado por Wompi (Bancolombia)', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
            ],
          ),
        ],
      ],
    );
  }
}

class _Resultado extends StatelessWidget {
  const _Resultado({required this.ok, required this.monto, this.onClose, this.onRetry});
  final bool ok;
  final String monto;
  final VoidCallback? onClose;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final color = ok ? UDS.state.success : UDS.state.danger;
    return Center(
      child: Padding(
        padding: EdgeInsets.all(UDS.space.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 84, height: 84,
              decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.15)),
              child: Icon(ok ? Icons.check_circle : Icons.error_outline, size: 48, color: color),
            ),
            SizedBox(height: UDS.space.s5),
            Text(ok ? '¡Pago aprobado!' : 'Pago no completado', style: TextStyle(fontSize: UDS.font.size.sxl, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
            SizedBox(height: UDS.space.s2),
            Text(ok ? 'Recibimos $monto. Tu servicio queda al día.' : 'No se concretó el pago. Puedes intentarlo de nuevo.',
                textAlign: TextAlign.center, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            SizedBox(height: UDS.space.s7),
            CicaButton(
              label: ok ? 'Listo' : 'Reintentar',
              fullWidth: true,
              onPressed: ok ? onClose : onRetry,
            ),
          ],
        ),
      ),
    );
  }
}

class _ManualSheet extends StatelessWidget {
  const _ManualSheet({required this.info, required this.monto});
  final ManualInfo info;
  final String monto;

  @override
  Widget build(BuildContext context) {
    final tieneDatos = (info.nequi?.isNotEmpty ?? false) || (info.bancolombia?.isNotEmpty ?? false);
    return Padding(
      padding: EdgeInsets.all(UDS.space.s5),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Transferencia manual', style: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
          SizedBox(height: UDS.space.s1),
          Text('Envía $monto a ${info.titular ?? 'CICANET'} y guarda el comprobante.', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
          SizedBox(height: UDS.space.s4),
          if (!tieneDatos)
            Text('Aún no hay cuentas configuradas. Contacta a soporte.', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.muted))
          else ...[
            if (info.nequi?.isNotEmpty ?? false) _cuenta(context, 'Nequi', info.nequi!),
            if (info.bancolombia?.isNotEmpty ?? false) _cuenta(context, 'Bancolombia', info.bancolombia!),
          ],
          SizedBox(height: UDS.space.s4),
        ],
      ),
    );
  }

  Widget _cuenta(BuildContext context, String banco, String numero) => Padding(
        padding: EdgeInsets.only(bottom: UDS.space.s3),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(banco, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                  Text(numero, style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                ],
              ),
            ),
            IconButton(
              icon: Icon(Icons.copy, color: UDS.accent.primary, size: 20),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: numero));
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$banco copiado')));
              },
            ),
          ],
        ),
      );
}
