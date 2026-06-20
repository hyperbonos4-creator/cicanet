/**
 * Base de conocimiento de CICANET para el asistente virtual.
 *
 * Es la "fuente de verdad" del bot: ancla las respuestas (RAG-lite) para que no
 * invente. Parte es estática (políticas, cómo funciona) y parte se inyecta en
 * vivo desde la config (si el pago en línea está activo, número de soporte, etc.).
 *
 * Mantener en español de Colombia, tono cercano y claro (clientes de barrio).
 */

export interface FaqEntry {
  id: string;
  /** Palabras clave para el recuperador determinista (sin tildes, minúsculas). */
  keywords: string[];
  pregunta: string;
  respuesta: string;
}

/** Identidad y contexto de la empresa (va al system prompt). */
export const EMPRESA = {
  nombre: 'CICANET',
  rubro: 'proveedor de internet por fibra óptica (ISP)',
  zona: 'Comuna 1 - Popular y el nororiente de Medellín, Colombia',
  tecnologia: 'FTTH (fibra óptica hasta el hogar)',
  moneda: 'COP (pesos colombianos)',
  horario: 'Lunes a sábado, 8:00 a.m. a 6:00 p.m.',
};

/**
 * FAQ curada. Sirve para (a) anclar al LLM y (b) responder sin LLM si no hay
 * clave configurada (fallback determinista por coincidencia de palabras clave).
 */
export const FAQ: FaqEntry[] = [
  {
    id: 'pago_como',
    keywords: ['pagar', 'pago', 'factura', 'pagos', 'abonar', 'cancelar factura', 'como pago'],
    pregunta: '¿Cómo pago mi factura?',
    respuesta:
      'Puedes pagar desde la app CICANET en segundos: entra a "Facturas", toca "Pagar" y elige el medio que prefieras (PSE, Nequi, tarjeta o Bancolombia). El pago se acredita automáticamente y tu servicio queda al día. También puedes pagar por transferencia manual a la cuenta de la empresa si lo prefieres.',
  },
  {
    id: 'pago_medios',
    keywords: ['pse', 'nequi', 'tarjeta', 'bancolombia', 'medios de pago', 'formas de pago', 'metodos', 'daviplata'],
    pregunta: '¿Qué medios de pago aceptan?',
    respuesta:
      'Aceptamos PSE (todos los bancos), Nequi, tarjetas de crédito/débito y transferencia Bancolombia, todo procesado de forma segura por Wompi (del grupo Bancolombia). También puedes hacer una transferencia manual a la cuenta de CICANET.',
  },
  {
    id: 'cobertura',
    keywords: ['cobertura', 'llega', 'disponible', 'mi barrio', 'mi direccion', 'instalar', 'instalacion', 'tienen servicio'],
    pregunta: '¿Tienen cobertura en mi dirección?',
    respuesta:
      'Cubrimos la Comuna 1 (Popular) y sectores del nororiente de Medellín con fibra óptica. Dime tu dirección o barrio y te oriento; para confirmarlo con exactitud el equipo verifica la NAP más cercana y los puertos disponibles. Si quieres, te puedo poner en contacto con un asesor para agendar la instalación.',
  },
  {
    id: 'planes',
    keywords: ['plan', 'planes', 'velocidad', 'megas', 'precio', 'cuanto cuesta', 'tarifa', 'mbps'],
    pregunta: '¿Qué planes y velocidades manejan?',
    respuesta:
      'Ofrecemos planes de fibra óptica (FTTH) para hogar y empresa con distintas velocidades. El precio y la velocidad exactos dependen del plan vigente en tu zona. Cuéntame para qué lo necesitas (ver/streaming, teletrabajo, varios dispositivos) y te recomiendo el plan ideal.',
  },
  {
    id: 'sin_servicio',
    keywords: ['sin internet', 'no funciona', 'no tengo internet', 'se cayo', 'lento', 'no sirve', 'falla', 'caido', 'no navega', 'no conecta'],
    pregunta: 'No tengo internet o está lento, ¿qué hago?',
    respuesta:
      'Probemos lo básico primero: 1) Revisa que el equipo (ONU/router) tenga luces encendidas; 2) Apágalo 30 segundos y vuelve a encenderlo; 3) Verifica que no tengas una factura vencida (un servicio suspendido por pago se reactiva solo al pagar). Si después de esto sigue sin servicio, te conecto con soporte técnico para revisar tu conexión.',
  },
  {
    id: 'suspension',
    keywords: ['suspendido', 'cortado', 'me cortaron', 'reactivar', 'reconexion', 'mora', 'vencida', 'deuda'],
    pregunta: 'Me suspendieron el servicio, ¿cómo lo reactivo?',
    respuesta:
      'Si el servicio se suspendió por una factura vencida, se reactiva automáticamente cuando registras el pago desde la app (PSE, Nequi, tarjeta). En cuanto el pago se confirma, tu internet vuelve solo, sin que tengas que llamar.',
  },
  {
    id: 'soporte_humano',
    keywords: ['humano', 'asesor', 'agente', 'hablar con alguien', 'persona', 'whatsapp', 'telefono', 'llamar', 'contacto'],
    pregunta: 'Quiero hablar con una persona',
    respuesta:
      'Claro. Te puedo conectar con nuestro equipo de soporte por WhatsApp para una atención personalizada. Usa el botón "Hablar con un asesor" y continúas la conversación con una persona del equipo CICANET.',
  },
  {
    id: 'app',
    keywords: ['app', 'aplicacion', 'descargar', 'celular', 'instalar app', 'iphone', 'android'],
    pregunta: '¿Qué puedo hacer en la app?',
    respuesta:
      'En la app CICANET puedes ver el estado de tu servicio en tiempo real, consultar y pagar tus facturas, revisar los dispositivos conectados y contactar a soporte. Está disponible para Android y iPhone.',
  },
  {
    id: 'velocidad_real',
    keywords: ['wifi lento', 'no llega la velocidad', 'lejos del router', 'medir velocidad', 'speedtest'],
    pregunta: 'El WiFi no me llega bien a toda la casa',
    respuesta:
      'La señal WiFi pierde fuerza con las paredes y la distancia. Ubica el router en un lugar central y elevado, lejos de microondas o muebles metálicos. Para velocidad máxima conecta por cable. Si tu casa es grande, podemos evaluar un repetidor o malla WiFi. ¿Quieres que te conecte con soporte para revisarlo?',
  },
];

/** Acciones rápidas que el cliente puede tocar (chips bajo el chat). */
export interface QuickAction {
  id: string;
  label: string;
  /** Tipo de acción que la UI sabe ejecutar. */
  tipo: 'pagar' | 'cobertura' | 'whatsapp' | 'facturas' | 'planes';
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'pagar', label: 'Pagar mi factura', tipo: 'pagar' },
  { id: 'cobertura', label: '¿Hay cobertura?', tipo: 'cobertura' },
  { id: 'planes', label: 'Ver planes', tipo: 'planes' },
  { id: 'whatsapp', label: 'Hablar con un asesor', tipo: 'whatsapp' },
];

/** Recupera las FAQ más relevantes para un texto (RAG-lite por palabras clave). */
export function retrieveFaq(text: string, limit = 3): FaqEntry[] {
  const t = normalize(text);
  const scored = FAQ.map((f) => {
    let score = 0;
    for (const k of f.keywords) {
      if (t.includes(normalize(k))) score += k.split(' ').length; // frases pesan más
    }
    return { f, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.f);
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .trim();
}
