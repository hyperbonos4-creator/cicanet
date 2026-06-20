import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/auth/auth_notifier.dart';

/// Perfil del técnico de campo. Identidad + cierre de sesión.
class TecnicoPerfilScreen extends ConsumerWidget {
  const TecnicoPerfilScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;
    final inicial = (user?.nombre.isNotEmpty ?? false) ? user!.nombre[0].toUpperCase() : 'T';

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
                  SizedBox(height: UDS.space.s1),
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: UDS.space.s3, vertical: 4),
                    decoration: BoxDecoration(color: UDS.accent.steel.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(20)),
                    child: Text('Técnico de campo', style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.semibold, color: UDS.accent.steel)),
                  ),
                  if ((user?.email ?? '').isNotEmpty) ...[
                    SizedBox(height: UDS.space.s2),
                    Text(user!.email, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
                  ],
                ],
              ),
            ),
            SizedBox(height: UDS.space.s7),
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
}
