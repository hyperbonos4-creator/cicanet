import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';

/// Dispositivos del hogar (blacklist). Mostrará los equipos detectados en la
/// red del cliente y permitirá bloquear los desconocidos vía GenieACS (TR-069)
/// — requiere CPE administrable (PLAN-MAESTRO P7).
class DispositivosScreen extends StatelessWidget {
  const DispositivosScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        title: const Text('Mis dispositivos'),
        titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
      ),
      body: const CicaEmptyState(
        icon: Icons.devices_outlined,
        title: 'Control de dispositivos',
        description: 'Aquí verás los equipos conectados a tu red y podrás bloquear los desconocidos. Disponible en routers compatibles con gestión remota (TR-069).',
      ),
    );
  }
}
