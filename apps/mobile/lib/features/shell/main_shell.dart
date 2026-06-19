import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/features/home/home_screen.dart';
import 'package:cicanet_mobile/features/facturas/facturas_screen.dart';
import 'package:cicanet_mobile/features/dispositivos/dispositivos_screen.dart';
import 'package:cicanet_mobile/features/profile/profile_screen.dart';

/// Contenedor principal con pestañas. Usa IndexedStack para conservar el
/// estado de cada pestaña al cambiar (no re-ejecuta initState).
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _index = 0;

  static const _tabs = [
    HomeScreen(),
    FacturasScreen(),
    DispositivosScreen(),
    ProfileScreen(),
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
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Inicio'),
            NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Facturas'),
            NavigationDestination(icon: Icon(Icons.devices_outlined), selectedIcon: Icon(Icons.devices), label: 'Dispositivos'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
          ],
        ),
      ),
    );
  }
}
