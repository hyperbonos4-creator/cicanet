import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

enum CicaButtonVariant { primary, secondary, ghost, danger }

enum CicaButtonSize { sm, md, lg }

/// Botón canónico del UDS (CICANET).
class CicaButton extends StatelessWidget {
  const CicaButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = CicaButtonVariant.primary,
    this.size = CicaButtonSize.md,
    this.leftIcon,
    this.rightIcon,
    this.loading = false,
    this.fullWidth = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final CicaButtonVariant variant;
  final CicaButtonSize size;
  final IconData? leftIcon;
  final IconData? rightIcon;
  final bool loading;
  final bool fullWidth;

  double get _height {
    switch (size) {
      case CicaButtonSize.sm:
        return 36;
      case CicaButtonSize.md:
        return 48;
      case CicaButtonSize.lg:
        return 56;
    }
  }

  ({Color? bg, Color fg, Color? borderColor, bool transparent}) _palette(
      BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    switch (variant) {
      case CicaButtonVariant.primary:
        return (bg: UDS.accent.primary, fg: scheme.onPrimary, borderColor: null, transparent: false);
      case CicaButtonVariant.secondary:
        return (bg: UDS.surface.raised, fg: UDS.text.primary, borderColor: UDS.border.strong, transparent: false);
      case CicaButtonVariant.ghost:
        return (bg: null, fg: UDS.text.primary, borderColor: null, transparent: true);
      case CicaButtonVariant.danger:
        return (bg: UDS.state.danger, fg: Colors.white, borderColor: null, transparent: false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    final palette = _palette(context);
    final radius = BorderRadius.circular(UDS.radius.md);

    Widget content;
    if (loading) {
      content = SizedBox(
        height: 18,
        width: 18,
        child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation<Color>(palette.fg)),
      );
    } else {
      final textStyle = TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.semibold, color: palette.fg, height: 1.2);
      final children = <Widget>[];
      if (leftIcon != null) {
        children.add(Icon(leftIcon, size: 18, color: palette.fg));
        children.add(SizedBox(width: UDS.space.s2));
      }
      children.add(Flexible(child: Text(label, style: textStyle, overflow: TextOverflow.ellipsis)));
      if (rightIcon != null) {
        children.add(SizedBox(width: UDS.space.s2));
        children.add(Icon(rightIcon, size: 18, color: palette.fg));
      }
      content = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: fullWidth ? MainAxisSize.max : MainAxisSize.min,
        children: children,
      );
    }

    final inner = InkWell(
      onTap: disabled ? null : onPressed,
      borderRadius: radius,
      child: Container(
        height: _height,
        padding: EdgeInsets.symmetric(horizontal: UDS.space.s5),
        decoration: BoxDecoration(
          borderRadius: radius,
          border: palette.borderColor != null ? Border.all(color: palette.borderColor!, width: 1) : null,
        ),
        alignment: Alignment.center,
        child: content,
      ),
    );

    Widget button = Opacity(
      opacity: disabled ? 0.4 : 1,
      child: palette.transparent
          ? Material(type: MaterialType.transparency, borderRadius: radius, child: inner)
          : Material(color: palette.bg, borderRadius: radius, child: inner),
    );

    if (fullWidth) button = SizedBox(width: double.infinity, child: button);
    return button;
  }
}
