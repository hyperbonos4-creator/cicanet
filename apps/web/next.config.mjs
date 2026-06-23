/** @type {import('next').NextConfig} */
// Proxy de mismo origen: el navegador habla solo con la web; Next reenvía
// /api y /socket.io al contenedor de la API. Así un único túnel (ngrok http 3080)
// expone TODO sin que el cliente necesite acceso a localhost:4000.
const API_TARGET = process.env.API_PROXY_TARGET || "http://api:4000";

const nextConfig = {
  reactStrictMode: true,
  // Permite servir nuestro emblema SVG propio vía next/image.
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  // Evita que Next redirija (308) la barra final de /socket.io/, que rompe el WebSocket.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_TARGET}/api/:path*` },
      // socket.io/engine.io piden exactamente "/socket.io/?..."; :path* no cubre
      // el caso de segmento vacío, así que se añade la ruta exacta.
      { source: "/socket.io/", destination: `${API_TARGET}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${API_TARGET}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
