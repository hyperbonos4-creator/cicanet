// Sistema de diseño de CICANET (UDS), basado en la arquitectura de tokens de
// URBAN pero con la identidad de CICANET: navy profundo + dorado eléctrico.
// Para alternar modo claro/oscuro: UDS.applyMode(Brightness.light).

import 'package:flutter/material.dart';

class UDS {
  UDS._();

  static final surface = _Surface();
  static final border = _Border();
  static final text = _Text();
  static final accent = _Accent();
  static final state = _State();
  static final radius = _Radius();
  static final space = _Space();
  static final font = _Font();

  static Brightness _mode = Brightness.dark;
  static Brightness get mode => _mode;

  static void applyMode(Brightness brightness) {
    _mode = brightness;
    surface._apply(brightness);
    border._apply(brightness);
    text._apply(brightness);
  }
}

class _Surface {
  Color base = const Color(0xFF04060C); // cica-black
  Color raised = const Color(0xFF0B1220); // cica-navy
  Color sunken = const Color(0xFF080C16);

  void _apply(Brightness b) {
    if (b == Brightness.light) {
      base = const Color(0xFFF6F8FC);
      raised = const Color(0xFFFFFFFF);
      sunken = const Color(0xFFEEF2F8);
    } else {
      base = const Color(0xFF04060C);
      raised = const Color(0xFF0B1220);
      sunken = const Color(0xFF080C16);
    }
  }
}

class _Border {
  Color subtle = const Color(0x1F3E6FB0);
  Color strong = const Color(0x383E6FB0);

  void _apply(Brightness b) {
    if (b == Brightness.light) {
      subtle = const Color(0xFFE2E8F0);
      strong = const Color(0xFFCBD5E1);
    } else {
      subtle = const Color(0x1F3E6FB0);
      strong = const Color(0x383E6FB0);
    }
  }
}

class _Text {
  Color primary = const Color(0xFFE9EDF5); // cica-silver
  Color dim = const Color(0xFF8B96AC); // cica-muted
  Color muted = const Color(0xFF64748B);

  void _apply(Brightness b) {
    if (b == Brightness.light) {
      primary = const Color(0xFF0B1220);
      dim = const Color(0xFF475569);
      muted = const Color(0xFF64748B);
    } else {
      primary = const Color(0xFFE9EDF5);
      dim = const Color(0xFF8B96AC);
      muted = const Color(0xFF64748B);
    }
  }
}

class _Accent {
  final Color primary = const Color(0xFFF5C518); // cica-gold
  final Color primaryHover = const Color(0xFFE0B400);
  final Color steel = const Color(0xFF3E6FB0); // cica-steel
}

class _State {
  final Color success = const Color(0xFF22E0A1); // FTTH
  final Color warning = const Color(0xFFFFB02E); // parcial
  final Color danger = const Color(0xFFFF4D6D); // sin/suspendido
  final Color info = const Color(0xFF3E6FB0);
}

class _Radius {
  final double sm = 10.0;
  final double md = 14.0;
  final double lg = 18.0;
}

class _Space {
  final double s1 = 4.0;
  final double s2 = 8.0;
  final double s3 = 12.0;
  final double s4 = 16.0;
  final double s5 = 20.0;
  final double s6 = 24.0;
  final double s7 = 32.0;
  final double s8 = 40.0;
}

class _Font {
  final size = const _FontSize();
  final weight = const _FontWeight();
}

class _FontSize {
  const _FontSize();
  final double sxs = 11.0;
  final double ssm = 13.0;
  final double smd = 15.0;
  final double slg = 17.0;
  final double sxl = 20.0;
  final double s2xl = 24.0;
  final double s3xl = 32.0;
}

class _FontWeight {
  const _FontWeight();
  final FontWeight regular = FontWeight.w400;
  final FontWeight medium = FontWeight.w500;
  final FontWeight semibold = FontWeight.w600;
  final FontWeight bold = FontWeight.w800;
}

class AppTheme {
  AppTheme._();

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    UDS.applyMode(brightness);
    final scheme = ColorScheme.fromSeed(
      seedColor: UDS.accent.primary,
      brightness: brightness,
    ).copyWith(
      surface: UDS.surface.base,
      surfaceContainer: UDS.surface.raised,
      surfaceContainerLow: UDS.surface.sunken,
      outline: UDS.border.subtle,
      outlineVariant: UDS.border.strong,
      primary: UDS.accent.primary,
      onPrimary: const Color(0xFF04060C),
      onSurface: UDS.text.primary,
      onSurfaceVariant: UDS.text.dim,
      error: UDS.state.danger,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: UDS.surface.base,
      textTheme: _textTheme(scheme),
    );
  }

  static TextTheme _textTheme(ColorScheme scheme) {
    final base = ThemeData(brightness: scheme.brightness).textTheme;
    return base
        .apply(bodyColor: UDS.text.primary, displayColor: UDS.text.primary)
        .copyWith(
          titleLarge: base.titleLarge?.copyWith(letterSpacing: -0.3),
          headlineSmall: base.headlineSmall?.copyWith(letterSpacing: -0.3),
        );
  }
}
