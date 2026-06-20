import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/pagos/pago_screen.dart';
import 'package:cicanet_mobile/features/me/me_api.dart';

/// Facturas reales del cliente autenticado (/me/facturas) con pago Wompi.
class FacturasScreen extends ConsumerStatefulWidget {
  const FacturasScreen({super.key});

  @override
  ConsumerState<FacturasScreen> createState() => _FacturasScreenState();
}

class _FacturasScreenState extends ConsumerState<FacturasScreen> {
  late Future<List<MiFactura>> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(meApiProvider).facturas();
  }

  Future<void> _recargar() async {
    setState(() => _future = ref.read(meApiProvider).facturas());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        title: const Text('Facturas'),
        titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _recargar,
          color: UDS.accent.primary,
          backgroundColor: UDS.surface.raised,
          child: FutureBuilder<List<MiFactura>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(UDS.accent.primary)));
              }
              if (snap.hasError) {
                return const _Mensaje(texto: 'Inicia sesión con tu documento de cliente para ver tus facturas.');
              }
              final facturas = snap.data ?? [];
              if (facturas.isEmpty) {
                return const _Mensaje(texto: 'No tienes facturas registradas todavía.');
              }
              return ListView.separated(
                padding: EdgeInsets.all(UDS.space.s5),
                itemCount: facturas.length,
                separatorBuilder: (_, __) => SizedBox(height: UDS.space.s3),
                itemBuilder: (_, i) => _FacturaCard(f: facturas[i], onPagada: _recargar),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _FacturaCard extends StatelessWidget {
  const _FacturaCard({required this.f, required this.onPagada});
  final MiFactura f;
  final Future<void> Function() onPagada;

  @override
  Widget build(BuildContext context) {
    final pagada = f.pagada;
    final color = pagada ? UDS.state.success : UDS.state.warning;
    final money = '\$${f.total.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => '.')}';

    return CicaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Factura ${f.periodo}', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                  const SizedBox(height: 2),
                  Text('Servicio CICANET', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim)),
                ],
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: UDS.space.s2, vertical: 4),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(UDS.radius.sm)),
                child: Text(pagada ? 'Pagada' : 'Pendiente', style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.semibold, color: color)),
              ),
            ],
          ),
          SizedBox(height: UDS.space.s4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(money, style: TextStyle(fontSize: UDS.font.size.s2xl, fontWeight: UDS.font.weight.bold, color: pagada ? UDS.text.primary : UDS.accent.primary)),
                  Text(pagada ? 'Pagada' : (f.fechaVencimiento != null ? 'Vence: ${f.fechaVencimiento}' : 'Pendiente'),
                      style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                ],
              ),
              if (!pagada)
                CicaButton(
                  label: 'Pagar',
                  leftIcon: Icons.bolt,
                  onPressed: () async {
                    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(
                      builder: (_) => PagoScreen(
                        montoCents: (f.total * 100).round(),
                        descripcion: 'Factura ${f.periodo} · Servicio CICANET',
                        facturaId: f.id,
                      ),
                    ));
                    if (ok == true) await onPagada();
                  },
                ),
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
        Icon(Icons.receipt_long_outlined, size: 48, color: UDS.text.muted),
        SizedBox(height: UDS.space.s4),
        Text(texto, textAlign: TextAlign.center, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
      ],
    );
  }
}
