import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

/// Pantalla de arranque mientras se resuelve el estado de sesión.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(colors: [UDS.accent.primary, UDS.accent.primaryHover]),
                boxShadow: [BoxShadow(color: UDS.accent.primary.withValues(alpha: 0.4), blurRadius: 24, spreadRadius: 2)],
              ),
              alignment: Alignment.center,
              child: Icon(Icons.wifi_tethering, size: 38, color: UDS.surface.base),
            ),
            SizedBox(height: UDS.space.s5),
            Text('CICANET', style: TextStyle(fontSize: UDS.font.size.s2xl, fontWeight: UDS.font.weight.bold, color: UDS.text.primary, letterSpacing: 1)),
            SizedBox(height: UDS.space.s2),
            Text('Tu internet, en tus manos', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            SizedBox(height: UDS.space.s7),
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation<Color>(UDS.accent.primary)),
            ),
          ],
        ),
      ),
    );
  }
}
