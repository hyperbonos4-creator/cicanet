/**
 * Configuración central de la API CICANET.
 * Todos los valores tienen default para que la API corra sin .env en la demo.
 * En producción se sobrescriben por variables de entorno.
 */
export const config = {
  port: parseInt(process.env.API_PORT || '4000', 10),

  // Servicios de geodatos REALES (sin claves; respetan las políticas de uso).
  geo: {
    // Proveedor: 'google' (idéntico a Google Maps, requiere key), 'mapbox' o 'nominatim' (OSM).
    geocoder: (process.env.GEOCODER_PROVIDER || 'mapbox').toLowerCase(),
    mapboxToken: process.env.MAPBOX_TOKEN || '',
    googleKey: process.env.GOOGLE_MAPS_KEY || '',
    // Caja de sesgo (lat,lng SW | lat,lng NE) — zona de operación nororiente.
    bounds: process.env.GEO_BOUNDS || '6.26,-75.60|6.35,-75.52',
    // Sesgo de cercanía (lng,lat) — zona de operación de la ISP (nororiente: Popular/Santa Cruz/Robledo).
    proximity: process.env.GEO_PROXIMITY || '-75.5550,6.2990',
    // Geocodificación de direcciones (dirección -> coordenadas) vía OpenStreetMap.
    nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    // Geolocalización por IP (sin clave).
    ipApiUrl: process.env.IP_API_URL || 'http://ip-api.com/json',
    // Identificación requerida por la política de uso de Nominatim.
    userAgent:
      process.env.GEO_USER_AGENT ||
      'CICANET-ISP-Platform/1.0 (contacto: soporte@cicanet.co)',
    // Sesgo geográfico: área metropolitana de Medellín (lon/lat).
    // viewbox = lonMin,latMax,lonMax,latMin
    viewbox: process.env.GEO_VIEWBOX || '-75.72,6.40,-75.45,6.13',
    countryCodes: process.env.GEO_COUNTRY || 'co',
    // Carpeta donde se persisten las NAP creadas en runtime.
    dataDir: process.env.DATA_DIR || 'data',
  },

  // Orígenes permitidos para CORS (el panel web).
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3100')
    .split(',')
    .map((s) => s.trim()),

  // Origen efectivo para enableCors / Socket.IO: si CORS_ORIGINS incluye '*'
  // se refleja cualquier origen (necesario al exponer por un túnel como ngrok).
  get corsOrigin(): true | string[] {
    return this.corsOrigins.includes('*') ? true : this.corsOrigins;
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'cicanet-dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'cicanet-dev-refresh-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },

  // Credenciales del primer admin (semilla). En producción se crean en BD.
  seedAdmin: {
    username: process.env.SEED_ADMIN_USER || 'admin',
    password: process.env.SEED_ADMIN_PASS || 'cicanet2026',
  },
};
