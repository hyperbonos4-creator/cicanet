import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/pagos/pago_screen.dart';

/// Facturas del cliente. La lista real vendrá de los endpoints del cliente
/// (PLAN-MAESTRO P1/P5). Por ahora muestra una factura pendiente de ejemplo
/// con el flujo de pago real (Wompi) ya funcional.
class FacturasScreen extends StatelessWidget {
  const FacturasScreen({super.key});

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
        child: ListView(
          padding: EdgeInsets.all(UDS.space.s5),
          children: [
            _FacturaCard(
              periodo: 'Junio 2026',
              descripcion: 'Plan Hogar 300 Megas',
              montoCents: 7000000,
              estado: 'pendiente',
              vence: '15 jul 2026',
            ),
            SizedBox(height: UDS.space.s3),
            _FacturaCard(
              periodo: 'Mayo 2026',
              descripcion: 'Plan Hogar 300 Megas',
              montoCents: 7000000,
              estado: 'pagada',
              vence: '15 jun 2026',
            ),
          ],
        ),
      ),
    );
  }
}

class _FacturaCard extends StatelessWidget {
  const _FacturaCard({required this.periodo, required this.descripcion, required this.montoCents, required this.estado, required this.vence});

  final String periodo;
  final String descripcion;
  final int montoCents;
  final String estado;
  final String vence;

  @override
  Widget build(BuildContext context) {
    final pagada = estado == 'pagada';
    final color = pagada ? UDS.state.success : UDS.state.warning;
    final money = '\$${(montoCents / 100).toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => '.')}';

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
                  Text('Factura $periodo', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                  SizedBox(height: 2),
                  Text(descripcion, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim)),
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
                  Text(pagada ? 'Pagada' : 'Vence: $vence', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                ],
              ),
              if (!pagada)
                CicaButton(
                  label: 'Pagar',
                  leftIcon: Icons.bolt,
                  onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => PagoScreen(montoCents: montoCents, descripcion: 'Factura $periodo · $descripcion'),
                    ));
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }
}
