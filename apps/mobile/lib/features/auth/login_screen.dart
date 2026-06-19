import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/auth/auth_notifier.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = await ref.read(authProvider.notifier).login(_user.text, _pass.text);
    if (!ok && mounted) {
      // El error se muestra debajo del formulario vía estado.
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    return Scaffold(
      backgroundColor: UDS.surface.base,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.all(UDS.space.s6),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(colors: [UDS.accent.primary, UDS.accent.primaryHover]),
                      boxShadow: [BoxShadow(color: UDS.accent.primary.withValues(alpha: 0.35), blurRadius: 20, spreadRadius: 1)],
                    ),
                    alignment: Alignment.center,
                    child: Icon(Icons.wifi_tethering, size: 32, color: UDS.surface.base),
                  ),
                  SizedBox(height: UDS.space.s4),
                  Text('CICANET', style: TextStyle(fontSize: UDS.font.size.s2xl, fontWeight: UDS.font.weight.bold, color: UDS.text.primary, letterSpacing: 1)),
                  SizedBox(height: UDS.space.s1),
                  Text('Accede a tu cuenta', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
                  SizedBox(height: UDS.space.s7),
                  CicaInput(label: 'Usuario / documento', hint: 'Tu documento o usuario', controller: _user, leftIcon: Icons.person_outline, keyboardType: TextInputType.text),
                  SizedBox(height: UDS.space.s4),
                  CicaInput(label: 'Contraseña', hint: '••••••••', controller: _pass, leftIcon: Icons.lock_outline, obscureText: true, onSubmitted: (_) => _submit()),
                  if (auth.error != null) ...[
                    SizedBox(height: UDS.space.s4),
                    Container(
                      width: double.infinity,
                      padding: EdgeInsets.all(UDS.space.s3),
                      decoration: BoxDecoration(
                        color: UDS.state.danger.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(UDS.radius.sm),
                        border: Border.all(color: UDS.state.danger.withValues(alpha: 0.4)),
                      ),
                      child: Text(auth.error!, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.state.danger)),
                    ),
                  ],
                  SizedBox(height: UDS.space.s6),
                  CicaButton(label: 'Ingresar', onPressed: _submit, loading: auth.loading, fullWidth: true, size: CicaButtonSize.lg),
                  SizedBox(height: UDS.space.s4),
                  Text('¿Olvidaste tu clave? Contacta a soporte.', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
