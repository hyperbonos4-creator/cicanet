import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

/// Encabezado de sección con título, subtítulo opcional y acción a la derecha.
class CicaSectionHeader extends StatelessWidget {
  const CicaSectionHeader({super.key, required this.title, this.subtitle, this.action});

  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: UDS.font.size.slg,
                  fontWeight: UDS.font.weight.semibold,
                  color: UDS.text.primary,
                  letterSpacing: -0.3,
                  height: 1.2,
                ),
              ),
              if (subtitle != null) ...[
                SizedBox(height: UDS.space.s1),
                Text(subtitle!, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.muted, height: 1.3)),
              ],
            ],
          ),
        ),
        if (action != null) ...[SizedBox(width: UDS.space.s3), action!],
      ],
    );
  }
}
