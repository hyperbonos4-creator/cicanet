import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/features/tecnico/mis_ordenes_screen.dart';
import 'package:cicanet_mobile/features/tecnico/tecnico_perfil_screen.dart';

/// Contenedor del apartado del TÉCNICO. Solo lo ven los usuarios con rol
/// `tecnico`: muestra sus órdenes de trabajo asignadas y su perfil. El admin
/// usa el panel web; este apartado es exclusivo del técnico de campo.
class TecnicoShell extends ConsumerStatefulWidget {
  const TecnicoShell({super.key});

  @override
  ConsumerState<TecnicoShell> createState() => _TecnicoShellState();
}

class _TecnicoShellState extends ConsumerState<TecnicoShell> {
  int _index = 0;

  static const _tabs = [
    MisOrdenesScreen(),
    TecnicoPerfilScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      body: IndexedStack(index: _index, children: _tabs),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: UDS.surface.raised,
          indicatorColor: UDS.accent.primary.withValues(alpha: 0.18),
          labelTextStyle: WidgetStateProperty.all(
            TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.medium, color: UDS.text.dim),
          ),
        ),
        child: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: 'Mis órdenes'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
          ],
        ),
      ),
    );
  }
}
