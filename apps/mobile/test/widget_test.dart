// Smoke test base de CICANET. La app real arranca con ProviderScope + router;
// aquí solo validamos que el árbol mínimo monta sin excepciones.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('monta un MaterialApp mínimo', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: Center(child: Text('CICANET')))),
    );
    expect(find.text('CICANET'), findsOneWidget);
  });
}
