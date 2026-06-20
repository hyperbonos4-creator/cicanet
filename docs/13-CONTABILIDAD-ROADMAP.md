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

## FASE 2 — Backoffice contable completo 🟠

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

### T2.4 — Exportables oficiales (Excel/PDF)
- Estados financieros y libros (diario, mayor, auxiliares, balance) a **Excel y PDF**
  con membrete CICANET. Reusar generación PDF del microservicio si aplica.
- **Aceptación:** descargar balance de comprobación del periodo en Excel cuadrado.

### T2.5 — Asientos recurrentes y depreciación automática
- Plantillas de asiento (nómina, depreciación mensual de equipos de red).
- Job que genera la depreciación del periodo desde `FixedAsset`.
- **Aceptación:** correr depreciación genera el asiento 516005/159205 esperado.

---

## FASE 3 — Cumplimiento fiscal y nómina (el "Siigo killer") 🟡

> Lo que amarra a la contadora a Helisa/Siigo en cierre anual. Trabajo fiscal pesado.

### T3.1 — Información exógena / medios magnéticos
- **Modelo:** mapeo `CuentaContable` → **concepto DIAN** (1001 pagos, 1003 retenciones
  practicadas, 1005 IVA descontable, 1006 IVA generado, 1007 ingresos, 1008 CxC, 1009 CxP).
- Generador anual: escanea movimientos, cruza NIT de terceros, exporta formatos
  (Excel/XML DIAN). Patrón validado por l10n_co de Odoo.
- **Aceptación:** generar formato 1001 de un año demo con totales por tercero correctos.

### T3.2 — Nómina electrónica
- **Aprovechar el módulo `nomina` de `facho`** (ya vendorizado: devengados, deducciones,
  salud, pensión, transporte, horas extra).
- Modelo de empleados/contratos, liquidación mensual, documento de nómina electrónica DIAN,
  y contabilización (gasto de personal + pasivos laborales + retenciones).
- **Aceptación:** liquidar una nómina demo emite el documento y deja el asiento cuadrado.

### T3.3 — NIIF / notas y cumplimiento
- Etiquetas NIIF en el PUC, notas a los estados financieros, conciliación fiscal básica.

---

## FASE 4 — Inteligencia y experiencia 🟢

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
2. **F2: CxP/gastos → Impuestos por reglas → Tipos de comprobante → Exportables → Depreciación** 🟠
3. **F3: Exógena → Nómina electrónica → NIIF** 🟡
4. **F4: Cica contable → Analítica/presupuesto → Portal** 🟢

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
