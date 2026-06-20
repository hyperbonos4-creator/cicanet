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

## FASE 1 — Recaudo y Cobranza de ISP (máxima prioridad) 🔴

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

### T1.4 — Dunning (cobro automático por WhatsApp/email)
- Reusar infra de WhatsApp + notificaciones existente.
- Reglas por aging: recordatorio amable (3 días antes), aviso de vencido, aviso de
  suspensión. Plantillas configurables. Idempotencia (no spamear).
- `POST /collections/dunning/run`, registro de envíos.
- **Aceptación:** un cliente en bucket 31-60 recibe el mensaje correcto una sola vez.

---

## FASE 2 — Backoffice contable completo 🟠

> Para que la contadora opere TODO el día a día sin salir de CICANET.

### T2.1 — Cuentas por pagar (AP) + proveedores + gastos
- **Modelo:** `FacturaCompra`, `Proveedor` (reusa `Tercero`), vencimientos.
- Registro de gastos/caja menor, **documento soporte** a no obligados (vía `einvoice`).
- **Retenciones practicadas** (retefuente/reteIVA/reteICA) automáticas al causar.
- Asiento: Dr Gasto/Activo + Dr IVA descontable, Cr CxP, Cr Retenciones.
- **Aceptación:** causar una compra con retención deja CxP, IVA descontable y
  retención por pagar correctos.

### T2.2 — Motor de impuestos por reglas
- **Modelo:** `ReglaImpuesto` (IVA 19/5/0, retenciones por concepto y base mínima).
- Aplicación automática en facturas de venta y compra (hoy es manual).
- **Aceptación:** una factura de $100.000 + IVA 19% calcula y contabiliza $19.000 sin digitarlo.

### T2.3 — Tipos de comprobante + consecutivos por tipo
- Recibo de Caja (RC-), Comprobante de Egreso (CE-), Nota de Contabilidad (NC-),
  Comprobante de Ingreso. Numeración por tipo (hoy todo es `CMP-`).
- **Aceptación:** cada tipo lleva su consecutivo independiente y se filtra en la bandeja.

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

1. **F1: Cartera/Aging → Facturación recurrente → Conciliación → Dunning** 🔴
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
