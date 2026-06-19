import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

enum CicaKpiAccent { primary, success, warning, danger, info }

/// Tile de KPI: icono + etiqueta + valor.
class CicaKpiTile extends StatelessWidget {
  const CicaKpiTile({super.key, required this.icon, required this.label, required this.value, this.accent = CicaKpiAccent.primary});

  final IconData icon;
  final String label;
  final String value;
  final CicaKpiAccent accent;

  Color _accentColor() {
    switch (accent) {
      case CicaKpiAccent.primary:
        return UDS.accent.primary;
      case CicaKpiAccent.success:
        return UDS.state.success;
      case CicaKpiAccent.warning:
        return UDS.state.warning;
      case CicaKpiAccent.danger:
        return UDS.state.danger;
      case CicaKpiAccent.info:
        return UDS.state.info;
    }
  }

  @override
  Widget build(BuildContext context) {
    final accentColor = _accentColor();
    return Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(color: accentColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(UDS.radius.md)),
          child: Icon(icon, color: accentColor, size: 24),
        ),
        SizedBox(width: UDS.space.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(label.toUpperCase(), style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted, letterSpacing: 0.5, fontWeight: UDS.font.weight.medium)),
              SizedBox(height: UDS.space.s1),
              Text(value, style: TextStyle(fontSize: UDS.font.size.s2xl, color: UDS.text.primary, fontWeight: UDS.font.weight.bold, fontFeatures: const [FontFeature.tabularFigures()], height: 1.1)),
            ],
          ),
        ),
      ],
    );
  }
}
