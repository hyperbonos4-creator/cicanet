# CICANET · Roadmap del Módulo Financiero-Contable

> Plan maestro para llevar el módulo contable de CICANET de "ledger correcto" a
> un **sistema financiero-operativo de ISP** que reemplace a Siigo/Helisa.
> Ordenado por prioridad de impacto. Cada fase se entrega **completa y verificada**
> (compila + prueba en vivo + commit) antes de pasar a la siguiente.

**Estado:** vigente desde 2026-06-20. Stack: NestJS + Prisma (api), Next.js (web),
microservicio `einvoice` (Python/facho), PostgreSQL, Docker.

---

## 0. Lo que YA está hecho (línea base) ✅

| Área | Estado |
|------|--------|
| Ledger doble partida (PUC Colombia, Decreto 2650, 104 cuentas) | ✅ |
| Asientos balanceados, **inmutables** (reversión), cierre de periodo | ✅ |
| Reportes: balance comprobación, P&G, balance general, libro mayor, dashboard | ✅ |
| Terceros, rol `contador`, workspace web (NAV por rol) | ✅ |
| Microservicio DIAN `einvoice` endurecido (API-key, CORS interno, sin secretos) | ✅ |
| Módulo `invoicing`: emite factura electrónica y **contabiliza el ingreso** | ✅ |

**Pendiente externo (no es código):** certificado de firma de CICANET, habilitación
del software ante la DIAN y resolución de numeración. Sin esto no se emite a DIAN en vivo.

---

## FASE 1 — Recaudo y Cobranza de ISP (máxima prioridad) ✅ COMPLETA (2026-06-20)

> Convierte el "libro contable" en un sistema de cartera y recaudo. Es lo que la
> contadora siente el primer día y el moat frente a Siigo (cartera georreferenciada).

### T1.1 — Cartera / Aging de cuentas por cobrar ✅ (2026-06-20)
- **Backend** `apps/api/src/collections/`:
  - Servicio de aging: por cliente, con buckets 0-30 / 31-60 / 61-90 / +90 días. ✅
  - Vistas agregadas: cartera **por barrio / NAP / zona / plan** (cruce con CRM + infra). ✅
  - Endpoints: `GET /collections/aging`, `/collections/aging/por-zona`, `/collections/cliente/:id`, `/collections/resumen`. ✅
- **Web** (workspace contador, pestaña "Cartera"): KPIs, antigüedad, por zona/NAP, clientes morosos. ✅
- **Verificado en vivo:** buckets exactos (porVencer/1-30/31-60/+90), cartera por barrio, total/vencido cuadran.

### T1.2 — Facturación recurrente por ciclo (la columna vertebral) ✅ (2026-06-20)
- **Backend** `apps/api/src/billing/`:
  - `preview` (dry-run sin escribir), `run` (genera + contabiliza), `suspender-morosos`. ✅
  - **Prorrateo** por días para altas a mitad de ciclo. ✅
  - **Idempotencia** garantizada por índice único `(servicioId, periodo)` en BD. ✅
  - Contabiliza cada factura (Dr 130505 CxC, Cr 414505 Ingreso, Cr 240805 IVA). ✅
  - Config en `Setting` (diaCorte, IVA, días de gracia). ✅
- **Suspensión por mora:** marca facturas vencidas y suspende servicio/cliente pasada la gracia. ✅
- **Web:** pestaña "Facturación" (preview, generar, suspender) — solo admin. ✅
- **Verificado:** preview 2 facturas/$135k, run contabiliza ambas, 2ª corrida idempotente (0), suspensión dry-run correcta.
- **Pendiente (cuando haya certs DIAN):** encadenar emisión electrónica por factura vía `invoicing`.

### T1.3 — Conciliación bancaria ✅ (2026-06-20)
- **Modelo Prisma:** `CuentaBancaria`, `MovimientoBancario` (hash único anti-duplicado). ✅
- **Backend** `apps/api/src/banking/`:
  - Importador de extracto **CSV** (separador y formato de fecha/valor flexibles, dedupe por hash). ✅
  - Sugerencias de match contra recaudos (`PagoTransaccion` APROBADA) por monto/fecha con confianza. ✅
  - Conciliar → genera asiento (entrada: Dr Banco/Cr contrapartida; salida: inverso). ✅
  - Endpoints: `POST /banking/import`, `GET /banking/sin-conciliar`, `/banking/movimientos/:id/sugerencias`, `POST .../conciliar`. ✅
- **Web:** pestaña "Bancos" (cuentas, importar CSV, conciliar/ignorar). ✅
- **Verificado:** import idempotente (reimport=0), conciliación entrada y salida generan asientos correctos, resumen cuadra.
- **Pendiente menor:** parser OFX (hoy CSV cubre el 80%).

### T1.4 — Dunning (cobro automático por WhatsApp/email) ✅ (2026-06-20)
- **Backend** `apps/api/src/dunning/` + `WhatsappService.sendText()` (Evolution). ✅
- Reglas por bucket (plantillas configurables en `Setting`), idempotencia por
  `(cliente, bucket, mes)` — solo los **envíos exitosos** bloquean reenvío; los
  fallidos se reintentan. Modelo `DunningEnvio`. ✅
- Endpoints: `GET /dunning/preview`, `POST /dunning/run` (simular/aplicar), `/dunning/historial`. ✅
- **Web:** pestaña "Cobranza" (simular, enviar, ver destinatarios y mensaje). ✅
- **Verificado:** preview por bucket prioritario, run real registra fallido cuando
  WhatsApp no está conectado y permite reintento; historial OK.

---

## FASE 2 — Backoffice contable completo ✅ COMPLETA (2026-06-20)

> Para que la contadora opere TODO el día a día sin salir de CICANET.

### T2.1 — Cuentas por pagar (AP) + proveedores + gastos ✅ (2026-06-20)
- **Modelo:** `FacturaCompra` (proveedor=Tercero, líneas Json, IVA descontable, retenciones). ✅
- **Backend** `apps/api/src/payables/`: causación + pago, ambos contabilizan
  (Dr gasto/activo + Dr IVA desc.; Cr CxP + Cr retefuente/reteIVA/reteICA). ✅
- Endpoints: `GET/POST /payables`, `/payables/resumen`, `POST /payables/:id/pagar`. ✅
- **Web:** pestaña "Compras / CxP" con formulario (líneas + IVA + retenciones) y pago. ✅
- **Verificado:** compra $1.000.000 + IVA 19% − retefuente 2.5% = $1.165.000 a pagar; pago contabilizado; balance cuadra.
- **Pendiente (certs DIAN):** emisión de documento soporte electrónico vía `einvoice`.

### T2.2 — Motor de impuestos por reglas ✅ (2026-06-20)
- **Modelo:** `ReglaImpuesto` (IVA 19/5, retefuente compras/servicios/honorarios con
  base mínima, reteIVA 15%, reteICA por mil), sembrada y editable por la contadora. ✅
- **Backend** `apps/api/src/taxes/`: `GET /taxes/reglas`, `POST /taxes/reglas`,
  `POST /taxes/calcular` (respeta base mínima; reteIVA sobre el IVA). ✅
- **Web:** botón "Sugerir retenciones" en el formulario de compras (concepto +
  reteIVA/reteICA) que prellena con el cálculo del motor. ✅
- **Verificado:** compras $1M → retefuente $0 (base<$1.3M), reteIVA $28.500; servicio
  $500k → retefuente $20.000, reteIVA $14.250, reteICA $4.830.

### T2.3 — Tipos de comprobante + consecutivos por tipo ✅ (2026-06-20)
- Numeración independiente por tipo: **RC** (recibo de caja), **CE** (egreso),
  **CC** (compra), **FV** (factura venta), **NC** (nota de contabilidad/ajuste),
  **AP** (apertura), **CIE** (cierre), **RV** (reversión). ✅
- **Web:** filtro por tipo en la bandeja de comprobantes. ✅
- **Verificado:** recaudo→RC-000001, manual→NC-000001 con consecutivos separados.

### T2.4 — Exportables oficiales (Excel/PDF) ✅ (2026-06-20)
- **Backend:** CSV (UTF-8 BOM, compatible Excel) de balance de comprobación y libro
  diario: `GET /accounting/reportes/balance.csv`, `/libro-diario.csv`. ✅
- **Web:** botones "Exportar (Excel)" y "Imprimir / PDF" (window.print) en Reportes. ✅
- **Verificado:** balance.csv descarga con encabezados, BOM y datos cuadrados.

### T2.5 — Asientos recurrentes y depreciación automática ✅ (2026-06-20)
- **Modelo:** `ActivoFijo` + `DepreciacionRegistro` (idempotencia por activo+periodo). ✅
- **Backend** `apps/api/src/assets/`: alta de activos, preview y corrida de
  depreciación (línea recta) que genera el asiento Dr 516005 / Cr 159205. ✅
- **Web:** pestaña "Activos" (registrar activo, ver depreciación acumulada, correr mes). ✅
- **Verificado:** OLT $36.000.000 / 60 meses → $600.000/mes; corrida idempotente.

---

## FASE 3 — Cumplimiento fiscal y nómina (el "Siigo killer") ✅ COMPLETA (2026-06-20)

> Lo que amarra a la contadora a Helisa/Siigo en cierre anual. Trabajo fiscal pesado.

### T3.1 — Información exógena / medios magnéticos ✅ (2026-06-20)
- **Backend** `apps/api/src/exogena/`: genera los formatos derivando del ledger por
  tercero — **1001** (pagos/gastos), **1003** (retenciones practicadas), **1005**
  (IVA descontable), **1006** (IVA generado), **1007** (ingresos), **1008** (CxC),
  **1009** (CxP). Hereda el tercero del asiento para líneas de ingreso/gasto. ✅
- Endpoints: `GET /exogena/formatos`, `/exogena/:formato?anio=`, `/exogena/:formato/csv`. ✅
- **Web:** pestaña "Exógena" (selector de formato + año, tabla por tercero, exportar Excel). ✅
- **Verificado:** 1007 ingresos $195k por 2 terceros; 1001 pagos $1.000.000.
- **Nota:** borrador que la contadora revisa antes de presentar (la clasificación fina de conceptos es criterio profesional).

### T3.2 — Nómina electrónica ✅ (2026-06-20)
- **Modelo:** `Empleado` + `LiquidacionNomina` (idempotente por empleado+periodo). ✅
- **Backend** `apps/api/src/payroll/`: maestro de empleados, liquidación (devengados −
  salud 4% − pensión 4%, auxilio de transporte) y contabilización
  (Dr 510506; Cr 237005 salud, 237006 pensión, 250505 neto al empleado). Crea las
  cuentas de aportes si faltan. Config (SMMLV/auxilio/%) editable. ✅
- **Web:** pestaña "Nómina" (empleados, preview, liquidar). ✅
- **Verificado:** empleado $2.000.000 → devengado $2.200.000, neto $2.040.000, idempotente.
- **Pendiente (certs DIAN):** emisión del documento de nómina electrónica vía `einvoice` (módulo `nomina` de facho).

### T3.3 — NIIF / presentación ✅ (2026-06-20)
- **Estado de Situación Financiera (NIIF):** activo/pasivo **corriente y no corriente**
  + patrimonio, clasificados desde el PUC; `GET /accounting/reportes/situacion-niif`. ✅
- **Web:** cuarto reporte "Situación financiera (NIIF)" en la pestaña Reportes. ✅
- **Verificado:** la ecuación Activo = Pasivo + Patrimonio cuadra.
- **Nota:** clasificación corriente/no corriente derivada del PUC (aproximación para
  revisión de la contadora); las notas y políticas NIIF son criterio profesional.

---

## FASE 4 — Inteligencia y experiencia 🟢

> **Reencuadrada en la Parte II (v2):** estas tareas se absorben en la **Fase H**
> (analítica vertical + Cica contable + portal), DESPUÉS de endurecer el core
> (Fases A–D de la Parte II). Se conservan aquí como referencia.

### T4.1 — Cica contable (agente para staff)
- Herramientas para admin/contador: "cartera vencida por barrio", "recaudo del día",
  "clientes con mora >60 días en Popular 2", "estado financiero del mes".
- Importa `AccountingService`/`ReportsService` + `collections` en el AgentToolsService (rol-gated).

### T4.2 — Presupuesto y analítica de ISP
- Presupuesto por centro de costo; **rentabilidad por nodo/NAP/zona**, ARPU por barrio,
  churn por mora, CAPEX vs clientes conectados (centros de costo en reportes).

### T4.3 — Portal del cliente (autofactura) y multimoneda (opcional)
- Descarga de factura electrónica y estado de cuenta desde la app del cliente.

---

## Orden de ejecución (resumen)

1. **F1: Cartera/Aging → Facturación recurrente → Conciliación → Dunning** ✅ COMPLETA
2. **F2: CxP/gastos → Impuestos por reglas → Tipos de comprobante → Exportables → Depreciación** ✅ COMPLETA
3. **F3: Exógena → Nómina electrónica → NIIF** ✅ COMPLETA
4. **PARTE II (v2) — siguiente foco:** endurecer el core → A: cash application + estados +
   workbench · B: motor de eventos + trazabilidad · C: tesorería · D: cierre robusto ·
   E: centro DIAN · F: cartera avanzada · G: activos red/contable · H: analítica + Cica + portal.
   **La Fase 4 original (Cica/analítica/portal) queda absorbida en la Fase H.**

## Principios transversales (se respetan en cada tarea)
- Doble partida siempre cuadrada y atómica; asientos inmutables (reversión).
- El **ledger es la fuente de verdad**, no el XML DIAN.
- Entrega best-effort: una falla de facturación/cobro **nunca** revierte el alta del cliente.
- RBAC: contabilidad solo `admin`/`contador`; código solo `admin`.
- Secretos solo en env/secret store; nunca en repo ni en logs.
- Cada fase: compilar + verificar en vivo + commit + push.

## Activos existentes que se reutilizan
- `einvoice` (DIAN: factura, nota, documento soporte, **nómina** vía facho).
- Infra WhatsApp + notificaciones (dunning).
- Customer 360 + topología/NAP (cartera georreferenciada).
- Máquina de estados de servicio (suspensión por mora).
- `AuditLog` (trazabilidad contable).

---
---

# PARTE II — v2: Endurecer el corazón financiero-operativo

**Estado:** añadido 2026-06-20 tras revisión de arquitectura (producto + contable).

## Contexto y veredicto

Las Fases 1–3 dejaron a CICANET con un **ERP contable vertical para ISP** funcional:
ledger PUC, cartera/aging, facturación recurrente, conciliación, dunning, CxP con
retenciones, impuestos por reglas, tipos de comprobante, exportables, depreciación,
exógena (1001–1009), nómina y NIIF. El moat NO es "tener contabilidad", es la
**unificación operativa**: contabilidad + cartera + facturación recurrente + red/NAP
+ suspensión por mora + DIAN + WhatsApp de cobranza, en un solo sistema.

**El siguiente salto NO es agregar más pestañas.** Es endurecer el corazón
financiero-operativo y cerrar el acople entre módulos. Riesgo #1 actual: que
Nómina/Activos/Exógena/DIAN crezcan más rápido que el **modelo contable y la
trazabilidad fiscal** que los soporta.

## Arquitectura objetivo: 5 subledgers + GL + motor de eventos

Formalizar el sistema financiero en **subledgers** con responsabilidad clara, todos
alimentando el **GL** por un **motor de eventos contables** (no contabilización a mano
dispersa en cada módulo):

1. **AR — Cuentas por cobrar:** factura de venta, saldo del cliente, recaudo, notas
   crédito, aging, promesas de pago, suspensión por mora.
2. **AP — Cuentas por pagar:** factura de proveedor, causación, pagos, retenciones,
   documento soporte.
3. **Cash / Tesorería:** cuentas bancarias y cajas, extractos, conciliación,
   transferencias internas, recaudos no aplicados, comisiones (Wompi/GMF).
4. **GL — General Ledger:** comprobantes, diario, mayor, balance, P&G, cierres,
   reversos, ajustes.
5. **Tax / DIAN:** FE, documento soporte, nómina electrónica, retenciones, IVA
   generado/descontable, exógena, estados de envío/aceptación/rechazo.

### Motor de eventos contables (posting engine)
El dominio operativo emite **eventos de negocio**; Contabilidad los escucha y genera
el comprobante (con trazabilidad de origen), en vez de incrustar la lógica contable
dentro de cada módulo:

```
invoice.issued · invoice.voided · payment.received · payment.applied
bank.movement.conciliated · purchase.invoice.recorded · purchase.invoice.paid
service.suspended_for_debt · writeoff.created · credit.note.issued
payroll.closed · depreciation.posted
```

### Trazabilidad sagrada (modelo de datos)
Todo `AsientoContable` debe poder responder sin dolor: qué documento lo originó, qué
módulo/usuario/job lo creó, si fue automático o manual, qué tercero/cliente/servicio/
NAP/zona impactó, qué periodo tocó, qué asiento lo revirtió, si tiene relación DIAN,
si está conciliado contra banco y aplicado contra cartera. (Hoy ya hay
`referenciaTipo/referenciaId`; **v2 amplía** a `sourceModule`, `autoGenerado`,
`napId/zonaId/servicioId`, `centroCosto` por línea).

## Piezas duras que faltan (lo que vuelve "producción seria")

1. **Cash application / Recibo de caja** (lo más crítico): `ReciboCaja` +
   `AplicacionPago` con abono parcial, pago de múltiples facturas, anticipos/saldo a
   favor, pagos no identificados (huérfanos), comisión/redondeo, reversión de aplicación.
2. **Máquinas de estado documental:** factura venta (draft→posted→electronic_*→
   partially_paid→paid→overdue→cancelled→reversed), factura compra, extracto bancario,
   comprobante. Hoy hay `estado` simple; v2 formaliza transiciones válidas.
3. **Tesorería:** cuentas/cajas como entidad de 1er nivel, traslados entre cuentas,
   egresos manuales, caja menor, anticipos a/ de proveedores y clientes, legalización,
   comisiones bancarias/GMF, recaudos no identificados, arqueo, flujo de caja proyectado.
4. **Cierre robusto:** checklist de cierre, validaciones pre-cierre (borradores,
   descuadres, terceros incompletos, cuentas sin mapeo DIAN, activos sin vida útil),
   secuencia de cierre mensual con lock.
5. **Workbench del contador (UX):** la pantalla inicial debe ser una **bandeja de
   pendientes**, no KPIs ejecutivos.
6. **Centro DIAN unificado:** una vista que agrupe FE, notas, documento soporte,
   nómina electrónica, exógena, certificados/resolución, estados y reprocesos.
7. **Cartera "de guerra":** acuerdos de pago, refinanciación, condonación parcial,
   castigo de cartera, reconexión con abono mínimo, intereses de mora, reactivación.
8. **Activo de red ≠ activo fijo contable:** separar `AssetRegistry` operativo
   (seriales/comodato/stock) de `FixedAssetAccounting` (depreciación), con vínculo.

## Roadmap v2 re-priorizado (por madurez funcional)

> Principio: **endurecer el core antes de abrir frentes nuevos.**

### FASE A — Cash application + estados documentales + bandeja del contador 🔴 (siguiente)
- **A1. Recibo de caja / aplicación de pagos** (parcial, múltiple, anticipos, huérfanos,
  reversión). Conecta recaudo Wompi/transferencia → factura(s) → asiento → cartera.
- **A2. Máquinas de estado** en factura venta, factura compra, extracto, comprobante.
- **A3. Workbench del contador:** home con bandejas accionables (pagos sin aplicar,
  conciliaciones pendientes, facturas proveedor por pagar, morosos >30/60/90,
  documentos DIAN rechazados, comprobantes descuadrados/borrador, nómina/exógena pendientes).

### FASE B — Motor de eventos contables + trazabilidad ampliada 🔴
- **B1. Posting engine** desacoplado por eventos (emisor único de asientos por evento).
- **B2. Trazabilidad ampliada** en asiento/línea (sourceModule, napId/zonaId/servicioId,
  centroCosto, autoGenerado, relación DIAN/banco/cartera) + drill-down KPI→asiento→soporte.

### FASE C — Tesorería 🟠
- Cuentas/cajas de 1er nivel, traslados, egresos, caja menor, anticipos y legalización,
  comisiones/GMF, recaudos no identificados, arqueo, flujo de caja proyectado.

### FASE D — Cierre mensual robusto 🟠
- Checklist + validaciones pre-cierre + secuencia de cierre con lock e informe de cuadre.

### FASE E — Centro DIAN unificado + estados 🟠
- Vista única de FE/notas/documento soporte/nómina/exógena + certificados/resolución +
  reprocesos/errores. Exógena con **motor de mapeo parametrizable** (cuenta→concepto DIAN)
  y bandeja de validación (NIT inválidos, terceros sin municipio/DV, movimientos sin mapeo,
  diferencias contra ledger) antes de exportar.

### FASE F — Cartera avanzada (cobranza "de guerra") 🟡
- Acuerdos/refinanciación/condonación/castigo, reconexión con abono mínimo, intereses de
  mora, historial de gestión de cobro por cliente.

### FASE G — Activos: separar red vs contable 🟡
- `AssetRegistry` operativo (seriales/comodato/MAC/stock) ↔ `FixedAssetAccounting`
  (depreciación, centro de costo, baja/venta/traslado/mejora), libro auxiliar de activos.

### FASE H — Analítica vertical ISP + centros de costo 🟢
- Centros de costo como entidad de 1er nivel (admin/soporte/instalación/backbone/nodo).
- Reportes: ingreso por barrio, cartera vencida por NAP, mora por plan, recaudo por
  canal, ARPU por zona, costo de red vs ingreso por nodo, churn por mora.
- Cica contable (consultas en lenguaje natural sobre cartera/recaudo/estado financiero).
- Portal del cliente (autofactura / estado de cuenta).

## Sprint inmediato sugerido (lo más peligroso primero)
1. **Cash application / recibo de caja** (A1) — sin esto, cartera y conciliación se enredan.
2. **Máquinas de estado documental** (A2).
3. **Workbench del contador** (A3).
4. **Posting engine por eventos + trazabilidad** (B).

## Evaluación honesta
- Dirección arquitectónica: sólida. El orden (operación→cartera→conciliación→ledger→
  reportes) es el correcto para un ISP.
- Para "sentar a una contadora todos los días" en producción faltan, sobre todo:
  **cash application**, **tesorería**, **máquinas de estado**, **posting engine**,
  **cierre formal** y **UX de bandejas**. Eso es la Fase A–D de esta Parte II.
- Posicionamiento de producto: no es "tenemos contabilidad" sino **"backoffice
  financiero-operativo nativo para ISP"** (cartera, recaudo, facturación recurrente,
  suspensión por mora, conciliación, DIAN y rentabilidad por nodo/zona).
