/**
 * Plan Único de Cuentas (PUC Colombia, Decreto 2650) — subconjunto adaptado a un
 * ISP. La jerarquía, naturaleza y nivel se DERIVAN del código (no se digitan)
 * para garantizar consistencia:
 *   - Clase = primer dígito (1..9).
 *   - Nivel por longitud: 1=clase, 2=grupo, 4=cuenta, 6=subcuenta, 8=auxiliar.
 *   - Naturaleza del saldo normal: clases 1,5,6,7,8 = débito; 2,3,4,9 = crédito.
 *   - Padre = código truncado al nivel anterior.
 *
 * Solo las cuentas marcadas `imputable` reciben movimientos; las de título
 * (clase/grupo/cuenta) consolidan saldos. La contadora puede crear más cuentas
 * desde el panel; esto es la base mínima para operar un ISP.
 */

export interface SeedAccount {
  codigo: string;
  nombre: string;
  imputable?: boolean;
  exigeTercero?: boolean;
  exigeCentro?: boolean;
}

/** Nombres de las clases PUC para autogenerar los títulos de nivel 1. */
const CLASES: Record<string, string> = {
  '1': 'ACTIVO',
  '2': 'PASIVO',
  '3': 'PATRIMONIO',
  '4': 'INGRESOS',
  '5': 'GASTOS',
  '6': 'COSTOS DE VENTAS',
  '7': 'COSTOS DE PRODUCCIÓN O DE OPERACIÓN',
  '8': 'CUENTAS DE ORDEN DEUDORAS',
  '9': 'CUENTAS DE ORDEN ACREEDORAS',
};

/**
 * Cuentas operativas de un ISP. Los títulos intermedios (grupo/cuenta) se
 * autocompletan a partir de estas hojas para no repetir; aquí van las que
 * importan, marcando cuáles son imputables.
 */
export const PUC_ISP: SeedAccount[] = [
  // ---- 1 ACTIVO ----
  { codigo: '11', nombre: 'DISPONIBLE' },
  { codigo: '1105', nombre: 'Caja' },
  { codigo: '110505', nombre: 'Caja general', imputable: true },
  { codigo: '110510', nombre: 'Caja menor', imputable: true },
  { codigo: '1110', nombre: 'Bancos' },
  { codigo: '111005', nombre: 'Bancolombia cuenta corriente', imputable: true },
  { codigo: '111010', nombre: 'Bancolombia cuenta de ahorros', imputable: true },
  { codigo: '1115', nombre: 'Cuentas de ahorro y recaudo' },
  { codigo: '111505', nombre: 'Recaudos pasarela (Wompi) en tránsito', imputable: true },
  { codigo: '111510', nombre: 'Nequi empresarial', imputable: true },
  { codigo: '13', nombre: 'DEUDORES' },
  { codigo: '1305', nombre: 'Clientes' },
  { codigo: '130505', nombre: 'Clientes nacionales (servicio de internet)', imputable: true, exigeTercero: true },
  { codigo: '1355', nombre: 'Anticipo de impuestos y contribuciones' },
  { codigo: '135515', nombre: 'Retención en la fuente que nos practican', imputable: true },
  { codigo: '135517', nombre: 'Retención de IVA que nos practican', imputable: true },
  { codigo: '15', nombre: 'PROPIEDADES PLANTA Y EQUIPO' },
  { codigo: '1524', nombre: 'Equipo de oficina' },
  { codigo: '152405', nombre: 'Equipo de oficina', imputable: true },
  { codigo: '1528', nombre: 'Equipo de cómputo y comunicación' },
  { codigo: '152805', nombre: 'Equipo de redes y telecomunicaciones (OLT, switches, NAP)', imputable: true },
  { codigo: '152810', nombre: 'Equipos de cómputo', imputable: true },
  { codigo: '1540', nombre: 'Flota y equipo de transporte' },
  { codigo: '154005', nombre: 'Vehículos', imputable: true },
  { codigo: '1592', nombre: 'Depreciación acumulada' },
  { codigo: '159205', nombre: 'Depreciación acumulada equipo de red', imputable: true },

  // ---- 2 PASIVO ----
  { codigo: '23', nombre: 'CUENTAS POR PAGAR' },
  { codigo: '2335', nombre: 'Costos y gastos por pagar' },
  { codigo: '233525', nombre: 'Proveedores y contratistas', imputable: true, exigeTercero: true },
  { codigo: '2365', nombre: 'Retención en la fuente' },
  { codigo: '236540', nombre: 'Compras (retefuente por pagar)', imputable: true },
  { codigo: '236505', nombre: 'Honorarios (retefuente por pagar)', imputable: true },
  { codigo: '236570', nombre: 'Servicios (retefuente por pagar)', imputable: true },
  { codigo: '2367', nombre: 'Impuesto a las ventas retenido (reteIVA)' },
  { codigo: '236701', nombre: 'ReteIVA por pagar', imputable: true },
  { codigo: '2368', nombre: 'Impuesto de industria y comercio retenido (reteICA)' },
  { codigo: '236801', nombre: 'ReteICA por pagar', imputable: true },
  { codigo: '24', nombre: 'IMPUESTOS GRAVÁMENES Y TASAS' },
  { codigo: '2408', nombre: 'Impuesto sobre las ventas por pagar (IVA)' },
  { codigo: '240805', nombre: 'IVA generado (19%)', imputable: true },
  { codigo: '240810', nombre: 'IVA descontable', imputable: true },
  { codigo: '2412', nombre: 'Impuesto de industria y comercio (ICA)' },
  { codigo: '241205', nombre: 'ICA por pagar', imputable: true },
  { codigo: '25', nombre: 'OBLIGACIONES LABORALES' },
  { codigo: '2505', nombre: 'Salarios por pagar' },
  { codigo: '250505', nombre: 'Salarios por pagar', imputable: true, exigeTercero: true },
  { codigo: '28', nombre: 'OTROS PASIVOS' },
  { codigo: '2805', nombre: 'Anticipos y avances recibidos' },
  { codigo: '280505', nombre: 'Anticipos de clientes', imputable: true, exigeTercero: true },

  // ---- 3 PATRIMONIO ----
  { codigo: '31', nombre: 'CAPITAL SOCIAL' },
  { codigo: '3115', nombre: 'Aportes sociales' },
  { codigo: '311505', nombre: 'Cuotas o partes de interés social', imputable: true },
  { codigo: '36', nombre: 'RESULTADOS DEL EJERCICIO' },
  { codigo: '3605', nombre: 'Utilidad del ejercicio' },
  { codigo: '360505', nombre: 'Utilidad del ejercicio', imputable: true },
  { codigo: '3610', nombre: 'Pérdida del ejercicio' },
  { codigo: '361005', nombre: 'Pérdida del ejercicio', imputable: true },
  { codigo: '37', nombre: 'RESULTADOS DE EJERCICIOS ANTERIORES' },
  { codigo: '3705', nombre: 'Utilidades acumuladas' },
  { codigo: '370505', nombre: 'Utilidades acumuladas', imputable: true },

  // ---- 4 INGRESOS ----
  { codigo: '41', nombre: 'OPERACIONALES' },
  { codigo: '4145', nombre: 'Transporte, almacenamiento y comunicaciones' },
  { codigo: '414505', nombre: 'Servicio de internet (FTTH)', imputable: true },
  { codigo: '414510', nombre: 'Instalación y activación', imputable: true },
  { codigo: '414515', nombre: 'Reconexión', imputable: true },
  { codigo: '414520', nombre: 'Arrendamiento de equipos (router/ONU)', imputable: true },
  { codigo: '4175', nombre: 'Devoluciones en ventas (DB)' },
  { codigo: '417505', nombre: 'Devoluciones en ventas', imputable: true },
  { codigo: '42', nombre: 'NO OPERACIONALES' },
  { codigo: '4210', nombre: 'Financieros' },
  { codigo: '421005', nombre: 'Intereses de mora', imputable: true },

  // ---- 5 GASTOS ----
  { codigo: '51', nombre: 'OPERACIONALES DE ADMINISTRACIÓN' },
  { codigo: '5105', nombre: 'Gastos de personal' },
  { codigo: '510506', nombre: 'Sueldos', imputable: true },
  { codigo: '5135', nombre: 'Servicios' },
  { codigo: '513505', nombre: 'Aseo y vigilancia', imputable: true },
  { codigo: '513525', nombre: 'Acueducto y alcantarillado', imputable: true },
  { codigo: '513530', nombre: 'Energía eléctrica', imputable: true },
  { codigo: '513535', nombre: 'Teléfono e internet (canales/IP de tránsito)', imputable: true },
  { codigo: '513540', nombre: 'Arrendamiento de postes e infraestructura', imputable: true },
  { codigo: '5160', nombre: 'Depreciaciones' },
  { codigo: '516005', nombre: 'Depreciación equipo de red', imputable: true },
  { codigo: '52', nombre: 'OPERACIONALES DE VENTAS' },
  { codigo: '5235', nombre: 'Servicios (ventas)' },
  { codigo: '523505', nombre: 'Publicidad y mercadeo', imputable: true },
  { codigo: '53', nombre: 'NO OPERACIONALES' },
  { codigo: '5305', nombre: 'Financieros' },
  { codigo: '530505', nombre: 'Gastos bancarios', imputable: true },
  { codigo: '530515', nombre: 'Comisiones (pasarela de pagos Wompi)', imputable: true },
  { codigo: '5315', nombre: 'Gastos extraordinarios' },
  { codigo: '531595', nombre: 'Otros (cartera incobrable)', imputable: true },

  // ---- 6 COSTOS DE VENTAS ----
  { codigo: '61', nombre: 'COSTO DE VENTAS Y DE PRESTACIÓN DE SERVICIOS' },
  { codigo: '6145', nombre: 'Transporte, almacenamiento y comunicaciones' },
  { codigo: '614505', nombre: 'Costo de ancho de banda / tránsito IP', imputable: true },
  { codigo: '614510', nombre: 'Materiales de instalación (fibra, conectores, ONU)', imputable: true },
];

/** Naturaleza del saldo normal por clase PUC. */
export function naturalezaDeClase(clase: number): 'debito' | 'credito' {
  return [1, 5, 6, 7, 8].includes(clase) ? 'debito' : 'credito';
}

/** Nivel jerárquico según longitud del código PUC. */
export function nivelDeCodigo(codigo: string): string {
  switch (codigo.length) {
    case 1: return 'clase';
    case 2: return 'grupo';
    case 4: return 'cuenta';
    case 6: return 'subcuenta';
    default: return 'auxiliar';
  }
}

/** Código del padre inmediato (al nivel anterior). null si es clase. */
export function padreDeCodigo(codigo: string): string | null {
  const cortes = [1, 2, 4, 6, 8];
  const len = codigo.length;
  for (let i = cortes.length - 1; i >= 0; i--) {
    if (cortes[i] < len) return codigo.slice(0, cortes[i]);
  }
  return null;
}

/**
 * Expande el seed a la lista COMPLETA de cuentas (incluyendo los títulos
 * intermedios que falten) con clase/naturaleza/nivel/padre derivados.
 */
export function expandirPUC(): Array<{
  codigo: string; nombre: string; clase: number; naturaleza: string;
  nivel: string; padreCodigo: string | null; imputable: boolean;
  exigeTercero: boolean; exigeCentro: boolean;
}> {
  const map = new Map<string, { nombre: string; imputable: boolean; exigeTercero: boolean; exigeCentro: boolean }>();

  // 1) Sembrar las clases (nivel 1).
  for (const [digito, nombre] of Object.entries(CLASES)) {
    map.set(digito, { nombre, imputable: false, exigeTercero: false, exigeCentro: false });
  }

  // 2) Insertar las cuentas del seed y autogenerar sus ancestros faltantes.
  for (const acc of PUC_ISP) {
    map.set(acc.codigo, {
      nombre: acc.nombre,
      imputable: !!acc.imputable,
      exigeTercero: !!acc.exigeTercero,
      exigeCentro: !!acc.exigeCentro,
    });
    // Garantizar la cadena de ancestros (títulos) exista.
    let padre = padreDeCodigo(acc.codigo);
    while (padre && !map.has(padre)) {
      map.set(padre, { nombre: `(${padre})`, imputable: false, exigeTercero: false, exigeCentro: false });
      padre = padreDeCodigo(padre);
    }
  }

  return [...map.entries()]
    .map(([codigo, v]) => {
      const clase = parseInt(codigo[0], 10);
      return {
        codigo,
        nombre: v.nombre,
        clase,
        naturaleza: naturalezaDeClase(clase),
        nivel: nivelDeCodigo(codigo),
        padreCodigo: padreDeCodigo(codigo),
        imputable: v.imputable,
        exigeTercero: v.exigeTercero,
        exigeCentro: v.exigeCentro,
      };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}
