import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:cicanet_mobile/features/soporte/soporte_api.dart';

/// Abre el chat de WhatsApp con el número de soporte configurado por el admin.
/// Si no hay número o soporte está deshabilitado, avisa al usuario.
Future<void> abrirSoporteWhatsapp(BuildContext context, WidgetRef ref) async {
  final messenger = ScaffoldMessenger.of(context);
  void aviso(String texto) =>
      messenger.showSnackBar(SnackBar(content: Text(texto)));

  try {
    final cfg = await ref.read(soporteApiProvider).whatsapp();
    if (!cfg.habilitado || cfg.url == null) {
      aviso('El soporte por WhatsApp no está disponible por ahora.');
      return;
    }
    final uri = Uri.parse(cfg.url!);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok) aviso('No se pudo abrir WhatsApp.');
  } catch (_) {
    aviso('No se pudo contactar a soporte. Intenta de nuevo.');
  }
}
