import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cicanet_mobile/core/theme/app_theme.dart';
import 'package:cicanet_mobile/core/uds/uds.dart';
import 'package:cicanet_mobile/features/auth/auth_notifier.dart';
import 'package:cicanet_mobile/features/pagos/pago_screen.dart';
import 'package:cicanet_mobile/features/asistente/asistente_screen.dart';
import 'package:cicanet_mobile/features/me/me_api.dart';

/// Inicio: estado real del servicio del cliente (desde /me/servicio).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  MiServicio? _srv;
  MiFactura? _pendiente;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final me = ref.read(meApiProvider);
      final srv = await me.servicio();
      List<MiFactura> facturas = [];
      try {
        facturas = await me.facturas();
      } catch (_) {}
      final pend = facturas.where((f) => !f.pagada && f.estado != 'anulada').toList()
        ..sort((a, b) => a.periodo.compareTo(b.periodo));
      setState(() {
        _srv = srv;
        _pendiente = pend.isNotEmpty ? pend.first : null;
        _loading = false;
      });
    } catch (_) {
      // Usuario no-cliente (staff) o sin servicio: mostramos estado neutro.
      setState(() {
        _loading = false;
        _error = true;
      });
    }
  }

  String _money(num pesos) =>
      '\$${pesos.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => '.')}';

  String _estadoLabel(String e) {
    switch (e) {
      case 'activo':
        return 'Servicio activo';
      case 'suspendido':
        return 'Servicio suspendido';
      case 'cortado':
        return 'Servicio cortado';
      case 'instalacion_pendiente':
        return 'Instalación pendiente';
      default:
        return 'Servicio';
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final nombre = user?.nombre.split(' ').first ?? 'cliente';
    final srv = _srv;
    final activo = srv?.activo ?? false;
    final estadoColor = srv == null
        ? UDS.text.muted
        : (activo ? UDS.state.success : UDS.state.danger);

    return Scaffold(
      backgroundColor: UDS.surface.base,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _cargar,
          color: UDS.accent.primary,
          backgroundColor: UDS.surface.raised,
          child: ListView(
            padding: EdgeInsets.all(UDS.space.s5),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Hola, $nombre', style: TextStyle(fontSize: UDS.font.size.s2xl, fontWeight: UDS.font.weight.bold, color: UDS.text.primary)),
                        SizedBox(height: UDS.space.s1),
                        Text('Tu servicio CICANET', style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
                      ],
                    ),
                  ),
                  CicaLiveDot(active: activo, label: activo ? 'En vivo' : 'Inactivo'),
                ],
              ),
              SizedBox(height: UDS.space.s5),

              // Tarjeta de estado del servicio
              CicaCard(
                child: _loading
                    ? Padding(
                        padding: EdgeInsets.symmetric(vertical: UDS.space.s5),
                        child: Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(UDS.accent.primary))),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 10, height: 10,
                                decoration: BoxDecoration(shape: BoxShape.circle, color: estadoColor, boxShadow: [BoxShadow(color: estadoColor.withValues(alpha: 0.6), blurRadius: 8)]),
                              ),
                              SizedBox(width: UDS.space.s2),
                              Text(srv != null ? _estadoLabel(srv.estadoServicio) : 'Sin servicio activo',
                                  style: TextStyle(fontSize: UDS.font.size.slg, fontWeight: UDS.font.weight.bold, color: estadoColor)),
                            ],
                          ),
                          SizedBox(height: UDS.space.s4),
                          _row('Plan', srv?.plan ?? '—'),
                          _row('Próximo pago', srv?.diaCorte != null ? 'Día ${srv!.diaCorte} de cada mes' : '—'),
                          _row('Saldo', srv != null ? _money(srv.saldo) : '—'),
                          if (_error) ...[
                            SizedBox(height: UDS.space.s2),
                            Text('Inicia sesión con tu documento de cliente para ver tu servicio.', style: TextStyle(fontSize: UDS.font.size.sxs, color: UDS.text.muted)),
                          ],
                        ],
                      ),
              ),
              SizedBox(height: UDS.space.s5),

              const CicaSectionHeader(title: 'Accesos rápidos'),
              SizedBox(height: UDS.space.s3),
              Row(
                children: [
                  Expanded(
                    child: CicaButton(
                      label: 'Pagar',
                      leftIcon: Icons.payments_outlined,
                      onPressed: _pendiente == null && (srv?.saldo ?? 0) <= 0
                          ? () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No tienes facturas pendientes 🎉')))
                          : () {
                              final monto = _pendiente != null ? _pendiente!.total : (srv?.saldo ?? 0);
                              Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => PagoScreen(
                                  montoCents: (monto * 100).round(),
                                  descripcion: _pendiente != null ? 'Factura ${_pendiente!.periodo}' : 'Saldo CICANET',
                                  facturaId: _pendiente?.id,
                                ),
                              ));
                            },
                    ),
                  ),
                  SizedBox(width: UDS.space.s3),
                  Expanded(child: CicaButton(label: 'Soporte', leftIcon: Icons.support_agent_outlined, variant: CicaButtonVariant.secondary, onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AsistenteScreen()));
                  })),
                ],
              ),
              SizedBox(height: UDS.space.s5),

              CicaCard(
                elevation: CicaCardElevation.flat,
                child: CicaKpiTile(
                  icon: Icons.speed,
                  label: 'Velocidad contratada',
                  value: srv?.velocidadBajada != null ? '${srv!.velocidadBajada} Mbps' : '—',
                  accent: CicaKpiAccent.info,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: EdgeInsets.symmetric(vertical: UDS.space.s2),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: TextStyle(fontSize: UDS.font.size.ssm, color: UDS.text.dim)),
            Text(value, style: TextStyle(fontSize: UDS.font.size.smd, fontWeight: UDS.font.weight.semibold, color: UDS.text.primary)),
          ],
        ),
      );
}
