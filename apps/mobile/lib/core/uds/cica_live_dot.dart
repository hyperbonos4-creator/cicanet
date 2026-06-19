import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

/// Indicador "En vivo": pulso verde cuando active=true, gris si no.
class CicaLiveDot extends StatefulWidget {
  const CicaLiveDot({super.key, required this.active, this.label});

  final bool active;
  final String? label;

  @override
  State<CicaLiveDot> createState() => _CicaLiveDotState();
}

class _CicaLiveDotState extends State<CicaLiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  static const double _dotSize = 10.0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 2));
    if (widget.active) _controller.repeat();
  }

  @override
  void didUpdateWidget(covariant CicaLiveDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.active && _controller.isAnimating) {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.active ? UDS.state.success : UDS.text.muted;
    final dot = SizedBox(
      width: _dotSize + 8,
      height: _dotSize + 8,
      child: Center(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final t = _controller.value;
            final haloScale = widget.active ? 1.0 + t * 1.5 : 1.0;
            final haloOpacity = widget.active ? (1.0 - t) * 0.5 : 0.0;
            return Stack(
              alignment: Alignment.center,
              children: [
                if (widget.active)
                  Container(
                    width: _dotSize * haloScale,
                    height: _dotSize * haloScale,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: haloOpacity)),
                  ),
                Container(width: _dotSize, height: _dotSize, decoration: BoxDecoration(shape: BoxShape.circle, color: color)),
              ],
            );
          },
        ),
      ),
    );

    if (widget.label == null) return dot;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        dot,
        SizedBox(width: UDS.space.s1),
        Text(widget.label!, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim, fontWeight: UDS.font.weight.medium)),
      ],
    );
  }
}
