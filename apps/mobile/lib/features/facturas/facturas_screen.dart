import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';

/// Facturas del cliente. Listará facturas (pagadas/pendientes/vencidas) y
/// permitirá descargar el PDF y pagar (PLAN-MAESTRO P1/P3).
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
      body: const CicaEmptyState(
        icon: Icons.receipt_long_outlined,
        title: 'Sin facturas aún',
        description: 'Cuando se active la facturación verás aquí tus facturas, podrás descargar el PDF y pagar en línea.',
      ),
    );
  }
}
