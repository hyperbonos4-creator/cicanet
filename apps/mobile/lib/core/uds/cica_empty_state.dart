import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/cica_button.dart';

/// Estado vacío canónico: icono + título + descripción + acción opcional.
class CicaEmptyState extends StatelessWidget {
  const CicaEmptyState({super.key, required this.icon, required this.title, this.description, this.action});

  final IconData icon;
  final String title;
  final String? description;
  final CicaButton? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(UDS.space.s6),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: UDS.surface.sunken, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Icon(icon, size: 32, color: UDS.text.dim),
            ),
            SizedBox(height: UDS.space.s4),
            Text(title, textAlign: TextAlign.center, style: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
            if (description != null) ...[
              SizedBox(height: UDS.space.s2),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 320),
                child: Text(description!, textAlign: TextAlign.center, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim, height: 1.4)),
              ),
            ],
            if (action != null) ...[SizedBox(height: UDS.space.s5), action!],
          ],
        ),
      ),
    );
  }
}
