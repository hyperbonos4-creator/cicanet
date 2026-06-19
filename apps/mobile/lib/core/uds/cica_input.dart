import 'package:flutter/material.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';

/// Campo de entrada canónico del UDS (CICANET).
class CicaInput extends StatefulWidget {
  const CicaInput({
    super.key,
    this.label,
    this.hint,
    this.error,
    this.controller,
    this.onChanged,
    this.onSubmitted,
    this.leftIcon,
    this.keyboardType,
    this.obscureText = false,
    this.enabled = true,
  });

  final String? label;
  final String? hint;
  final String? error;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final IconData? leftIcon;
  final TextInputType? keyboardType;
  final bool obscureText;
  final bool enabled;

  @override
  State<CicaInput> createState() => _CicaInputState();
}

class _CicaInputState extends State<CicaInput> {
  late final FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode()..addListener(_handleFocus);
  }

  void _handleFocus() => setState(() {});

  @override
  void dispose() {
    _focusNode.removeListener(_handleFocus);
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasError = widget.error != null && widget.error!.isNotEmpty;
    final hasFocus = _focusNode.hasFocus;
    final radius = BorderRadius.circular(UDS.radius.md);
    final borderColor = hasError ? UDS.state.danger : (hasFocus ? UDS.accent.primary : UDS.border.strong);
    final borderWidth = hasFocus || hasError ? 2.0 : 1.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.label != null) ...[
          Text(widget.label!, style: TextStyle(fontSize: UDS.font.size.ssm, fontWeight: UDS.font.weight.medium, color: UDS.text.primary)),
          SizedBox(height: UDS.space.s2),
        ],
        Container(
          constraints: const BoxConstraints(minHeight: 48),
          decoration: BoxDecoration(
            color: UDS.surface.raised,
            borderRadius: radius,
            border: Border.all(color: borderColor, width: borderWidth),
          ),
          padding: EdgeInsets.symmetric(horizontal: UDS.space.s4, vertical: UDS.space.s2),
          child: Row(
            children: [
              if (widget.leftIcon != null) ...[
                Icon(widget.leftIcon, size: 20, color: UDS.text.dim),
                SizedBox(width: UDS.space.s2),
              ],
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _focusNode,
                  onChanged: widget.onChanged,
                  onSubmitted: widget.onSubmitted,
                  keyboardType: widget.keyboardType,
                  obscureText: widget.obscureText,
                  enabled: widget.enabled,
                  style: TextStyle(fontSize: UDS.font.size.smd, color: UDS.text.primary),
                  cursorColor: UDS.accent.primary,
                  decoration: InputDecoration(
                    isDense: true,
                    isCollapsed: true,
                    border: InputBorder.none,
                    hintText: widget.hint,
                    hintStyle: TextStyle(fontSize: UDS.font.size.smd, color: UDS.text.muted),
                    contentPadding: EdgeInsets.symmetric(vertical: UDS.space.s2),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (hasError) ...[
          SizedBox(height: UDS.space.s1),
          Text(widget.error!, style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.state.danger, fontWeight: UDS.font.weight.medium)),
        ],
      ],
    );
  }
}
