import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

enum CicaCardElevation { flat, raised }

/// Tarjeta canónica del UDS (CICANET).
class CicaCard extends StatelessWidget {
  const CicaCard({
    super.key,
    required this.child,
    this.padding,
    this.elevation = CicaCardElevation.raised,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final CicaCardElevation elevation;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bg = elevation == CicaCardElevation.raised ? UDS.surface.raised : UDS.surface.base;
    final radius = BorderRadius.circular(UDS.radius.lg);
    final content = Padding(padding: padding ?? EdgeInsets.all(UDS.space.s5), child: child);

    final card = Material(
      color: bg,
      borderRadius: radius,
      child: onTap == null ? content : InkWell(onTap: onTap, borderRadius: radius, child: content),
    );

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        border: Border.all(color: UDS.border.subtle, width: 1),
      ),
      child: ClipRRect(borderRadius: radius, child: card),
    );
  }
}
