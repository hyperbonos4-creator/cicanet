import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/asistente/asistente_api.dart';
import 'package:cicanet_mobile/features/soporte/soporte_actions.dart';

class _Msg {
  _Msg(this.role, this.content, {this.acciones = const [], this.pago, this.ai = true});
  final String role; // user | assistant
  final String content;
  final List<CicaAccion> acciones;
  final CicaPago? pago;
  final bool ai;
}

/// Chat con "Cica", el asistente virtual de CICANET (agente de soporte).
class AsistenteScreen extends ConsumerStatefulWidget {
  const AsistenteScreen({super.key});

  @override
  ConsumerState<AsistenteScreen> createState() => _AsistenteScreenState();
}

class _AsistenteScreenState extends ConsumerState<AsistenteScreen> {
  final _ctrl = TextEditingController();
  final _scroll = ScrollController();
  final List<_Msg> _msgs = [];
  bool _sending = false;
  bool _ia = false;
  List<CicaAccion> _accionesIniciales = const [];

  @override
  void initState() {
    super.initState();
    _cargarInfo();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _cargarInfo() async {
    try {
      final info = await ref.read(asistenteApiProvider).info();
      setState(() {
        _ia = info.ia;
        _accionesIniciales = info.acciones;
        _msgs.add(_Msg('assistant', info.saludo, acciones: info.acciones, ai: info.ia));
      });
    } catch (_) {
      setState(() => _msgs.add(_Msg('assistant', '¡Hola! Soy Cica, el asistente de CICANET. ¿En qué te ayudo?')));
    }
  }

  void _scrollAbajo() {
    Future.delayed(const Duration(milliseconds: 80), () {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent + 120,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _enviar(String texto) async {
    final t = texto.trim();
    if (t.isEmpty || _sending) return;
    _ctrl.clear();
    setState(() {
      _msgs.add(_Msg('user', t));
      _sending = true;
    });
    _scrollAbajo();

    try {
      final history = _msgs
          .where((m) => m.role == 'user' || m.role == 'assistant')
          .map((m) => {'role': m.role, 'content': m.content})
          .toList();
      final r = await ref.read(asistenteApiProvider).chat(history);
      setState(() {
        _msgs.add(_Msg('assistant', r.reply, acciones: r.acciones, pago: r.pago, ai: r.ai));
      });
    } catch (_) {
      setState(() => _msgs.add(_Msg('assistant',
          'Uy, tuve un problema para responder. Intenta de nuevo o habla con un asesor.',
          acciones: _accionesIniciales)));
    } finally {
      setState(() => _sending = false);
      _scrollAbajo();
    }
  }

  Future<void> _accion(CicaAccion a) async {
    switch (a.tipo) {
      case 'whatsapp':
        await abrirSoporteWhatsapp(context, ref);
        break;
      case 'pagar':
        _enviar('Quiero pagar mi factura');
        break;
      case 'cobertura':
        _enviar('¿Tienen cobertura en mi dirección?');
        break;
      case 'planes':
        _enviar('¿Qué planes y velocidades manejan?');
        break;
      case 'facturas':
        _enviar('Quiero ver mis facturas');
        break;
    }
  }

  Future<void> _abrirPago(CicaPago p) async {
    final ok = await launchUrl(Uri.parse(p.url), mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo abrir el pago')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: UDS.surface.base,
      appBar: AppBar(
        backgroundColor: UDS.surface.base,
        iconTheme: IconThemeData(color: UDS.text.primary),
        titleSpacing: 0,
        title: Row(
          children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [UDS.accent.primary, UDS.accent.primaryHover])),
              alignment: Alignment.center,
              child: Icon(Icons.auto_awesome, size: 18, color: UDS.surface.base),
            ),
            SizedBox(width: UDS.space.s3),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Cica', style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                Row(children: [
                  Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, color: UDS.state.success)),
                  const SizedBox(width: 5),
                  Text(_ia ? 'Asistente IA · en línea' : 'Asistente · en línea',
                      style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim)),
                ]),
              ],
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView.builder(
                controller: _scroll,
                padding: EdgeInsets.all(UDS.space.s4),
                itemCount: _msgs.length + (_sending ? 1 : 0),
                itemBuilder: (_, i) {
                  if (_sending && i == _msgs.length) return const _Typing();
                  return _Burbuja(msg: _msgs[i], onAccion: _accion, onPago: _abrirPago);
                },
              ),
            ),
            _Composer(ctrl: _ctrl, enabled: !_sending, onSend: () => _enviar(_ctrl.text)),
          ],
        ),
      ),
    );
  }
}

class _Burbuja extends StatelessWidget {
  const _Burbuja({required this.msg, required this.onAccion, required this.onPago});
  final _Msg msg;
  final void Function(CicaAccion) onAccion;
  final void Function(CicaPago) onPago;

  @override
  Widget build(BuildContext context) {
    final esUser = msg.role == 'user';
    return Column(
      crossAxisAlignment: esUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Container(
          margin: EdgeInsets.only(bottom: UDS.space.s2, top: UDS.space.s1),
          padding: EdgeInsets.symmetric(horizontal: UDS.space.s4, vertical: UDS.space.s3),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
          decoration: BoxDecoration(
            color: esUser ? UDS.accent.primary : UDS.surface.raised,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(UDS.radius.lg),
              topRight: Radius.circular(UDS.radius.lg),
              bottomLeft: Radius.circular(esUser ? UDS.radius.lg : 4),
              bottomRight: Radius.circular(esUser ? 4 : UDS.radius.lg),
            ),
          ),
          child: Text(msg.content,
              style: TextStyle(
                  fontSize: UDS.font.size.ssm,
                  height: 1.35,
                  color: esUser ? UDS.surface.base : UDS.text.primary)),
        ),
        if (msg.pago != null)
          Padding(
            padding: EdgeInsets.only(bottom: UDS.space.s2),
            child: CicaButton(
              label: 'Pagar \$${msg.pago!.monto.toStringAsFixed(0)} ahora',
              leftIcon: Icons.lock_outline,
              onPressed: () => onPago(msg.pago!),
            ),
          ),
        if (!esUser && msg.acciones.isNotEmpty)
          Padding(
            padding: EdgeInsets.only(bottom: UDS.space.s3),
            child: Wrap(
              spacing: UDS.space.s2,
              runSpacing: UDS.space.s2,
              children: msg.acciones
                  .map((a) => _Chip(label: a.label, onTap: () => onAccion(a)))
                  .toList(),
            ),
          ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: UDS.space.s3, vertical: UDS.space.s2),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: UDS.accent.primary.withValues(alpha: 0.5)),
          color: UDS.accent.primary.withValues(alpha: 0.08),
        ),
        child: Text(label, style: TextStyle(fontSize: UDS.font.size.sxs, fontWeight: UDS.font.weight.semibold, color: UDS.accent.primary)),
      ),
    );
  }
}

class _Typing extends StatelessWidget {
  const _Typing();
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(top: UDS.space.s1, bottom: UDS.space.s2),
      padding: EdgeInsets.symmetric(horizontal: UDS.space.s4, vertical: UDS.space.s3),
      decoration: BoxDecoration(color: UDS.surface.raised, borderRadius: BorderRadius.circular(UDS.radius.lg)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(UDS.accent.primary))),
        SizedBox(width: UDS.space.s3),
        Text('Cica está escribiendo…', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.dim)),
      ]),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.ctrl, required this.enabled, required this.onSend});
  final TextEditingController ctrl;
  final bool enabled;
  final VoidCallback onSend;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(UDS.space.s4, UDS.space.s2, UDS.space.s4, UDS.space.s3),
      decoration: BoxDecoration(
        color: UDS.surface.base,
        border: Border(top: BorderSide(color: UDS.border.subtle)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: ctrl,
              enabled: enabled,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSend(),
              style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.primary),
              decoration: InputDecoration(
                hintText: 'Escribe tu mensaje…',
                hintStyle: TextStyle(color: UDS.text.muted, fontSize: UDS.font.size.ssm),
                filled: true,
                fillColor: UDS.surface.raised,
                contentPadding: EdgeInsets.symmetric(horizontal: UDS.space.s4, vertical: UDS.space.s3),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(UDS.radius.lg), borderSide: BorderSide.none),
              ),
            ),
          ),
          SizedBox(width: UDS.space.s2),
          GestureDetector(
            onTap: enabled ? onSend : null,
            child: Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(colors: [UDS.accent.primary, UDS.accent.primaryHover]),
              ),
              child: Icon(Icons.send_rounded, color: UDS.surface.base, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}
