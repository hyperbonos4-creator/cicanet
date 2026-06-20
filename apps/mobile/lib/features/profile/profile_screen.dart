import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/auth/auth_notifier.dart';
import 'package:cicanet_mobile/features/asistente/asistente_screen.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;
    final inicial = (user?.nombre.isNotEmpty ?? false) ? user!.nombre[0].toUpperCase() : '?';

    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        title: const Text('Perfil'),
        titleTextStyle: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary),
      ),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.all(UDS.space.s5),
          children: [
            Center(
              child: Column(
                children: [
                  Container(
                    width: 72, height: 72,
                    decoration: BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [UDS.accent.primary, UDS.accent.primaryHover])),
                    alignment: Alignment.center,
                    child: Text(inicial, style: TextStyle(fontSize: UDS.font.size.s2xl, fontWeight: UDS.font.weight.bold, color: UDS.surface.base)),
                  ),
                  SizedBox(height: UDS.space.s3),
                  Text(user?.nombre ?? '—', style: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                  Text(user?.email ?? '', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
                ],
              ),
            ),
            SizedBox(height: UDS.space.s6),
            CicaCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  _tile(Icons.lock_outline, 'Cambiar contraseña', () {}),
                  Divider(height: 1, color: UDS.border.subtle),
                  _tile(Icons.support_agent_outlined, 'Soporte', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AsistenteScreen()))),
                  Divider(height: 1, color: UDS.border.subtle),
                  _tile(Icons.info_outline, 'Acerca de CICANET', () {}),
                ],
              ),
            ),
            SizedBox(height: UDS.space.s6),
            CicaButton(
              label: 'Cerrar sesión',
              variant: CicaButtonVariant.danger,
              fullWidth: true,
              leftIcon: Icons.logout,
              onPressed: () => ref.read(authProvider.notifier).logout(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tile(IconData icon, String label, VoidCallback onTap) => ListTile(
        leading: Icon(icon, color: UDS.text.dim),
        title: Text(label, style: TextStyle(fontSize: UDS.font.size.smd, color: UDS.text.primary)),
        trailing: Icon(Icons.chevron_right, color: UDS.text.muted),
        onTap: onTap,
      );
}
