import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/auth/auth_notifier.dart';

/// Inicio: estado del servicio del cliente. Los valores se conectarán a los
/// endpoints del portal del cliente (PLAN-MAESTRO P5/P6). Hoy muestra la
/// estructura final con el usuario de sesión.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;
    final nombre = user?.nombre.split(' ').first ?? 'cliente';

    return Scaffold(
      backgroundColor: UDS.surface.base,
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.all(UDS.space.s5),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Hola, $nombre', style: TextStyle(fontSize: UDS.font.size.s2xl, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                      SizedBox(height: UDS.space.s1),
                      Text('Tu servicio CICANET', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
                    ],
                  ),
                ),
                const CicaLiveDot(active: true, label: 'En vivo'),
              ],
            ),
            SizedBox(height: UDS.space.s5),

            // Tarjeta de estado del servicio
            CicaCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 10, height: 10,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: UDS.state.success, boxShadow: [BoxShadow(color: UDS.state.success.withValues(alpha: 0.6), blurRadius: 8)]),
                      ),
                      SizedBox(width: UDS.space.s2),
                      Text('Servicio activo', style: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.state.success)),
                    ],
                  ),
                  SizedBox(height: UDS.space.s4),
                  _row('Plan', '—'),
                  _row('Próximo pago', '—'),
                  _row('Saldo', '\$0'),
                  SizedBox(height: UDS.space.s2),
                  Text('Los datos de tu plan aparecerán cuando se active el portal del cliente.', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                ],
              ),
            ),
            SizedBox(height: UDS.space.s5),

            const CicaSectionHeader(title: 'Accesos rápidos'),
            SizedBox(height: UDS.space.s3),
            Row(
              children: [
                Expanded(child: CicaButton(label: 'Pagar', leftIcon: Icons.payments_outlined, onPressed: () => _todo(context, 'Pago (Wompi)'))),
                SizedBox(width: UDS.space.s3),
                Expanded(child: CicaButton(label: 'Soporte', leftIcon: Icons.support_agent_outlined, variant: CicaButtonVariant.secondary, onPressed: () => _todo(context, 'Soporte'))),
              ],
            ),
            SizedBox(height: UDS.space.s5),

            const CicaCard(
              elevation: CicaCardElevation.flat,
              child: CicaKpiTile(icon: Icons.speed, label: 'Velocidad contratada', value: '—', accent: CicaKpiAccent.info),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: EdgeInsets.symmetric(vertical: UDS.space.s2),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            Text(value, style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.semibold, color: UDS.text.primary)),
          ],
        ),
      );

  void _todo(BuildContext context, String what) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$what — próximamente')));
  }
}
