# @cicanet/web — Panel CICANET (Next.js)

Panel operacional (Next.js 14 + MapLibre GL) con **acceso restringido por login** y el **mapa de cobertura en tiempo real** de Popular 2 con la identidad de marca CICANET.

> Requiere la API (`apps/api`) corriendo en `http://localhost:4000`.

## Correr en local (los dos juntos)

```bash
# Terminal 1 — API
cd apps/api && npm install && npm run dev      # http://localhost:4000

# Terminal 2 — Web
cd apps/web && npm install && npm run dev      # http://localhost:3000
```

Producción (más fluido para mostrar a clientes):

```bash
cd apps/web && npm run build && npm start
```

> Si el puerto 3000 está ocupado: `npx next start -p 3100`.

## Acceso

Entra en `http://localhost:3000` → redirige a **`/login`**.
Usuario `admin` · contraseña `cicanet2026`. Ninguna ruta es pública (gate en `middleware.ts`).

## Qué muestra

- **Login CICANET** y sesión con usuario/rol + botón salir.
- **Mapa oscuro** (CARTO, sin API key) centrado en Popular 2, Comuna 1.
- **Capas conmutables:** cobertura (FTTH / parcial / sin), fibra, nodos POP/NAP/CTO, clientes.
- **Métricas y nodos EN VIVO** vía Socket.IO (la ocupación de puertos fluctúa en tiempo real).
- **Consultar cobertura:** clic en cualquier punto del mapa → ¿hay FTTH? + NAP más cercano.

## Datos y configuración

- Los datos vienen de la API (`lib/api.ts`). Variables opcionales:
  `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`),
  `NEXT_PUBLIC_SOCKET_URL` (default `http://localhost:4000/realtime`).
- En producción, la API sirve desde **PostGIS + Martin** — ver `docs/07-MAPA-COBERTURA.md`.
- `lib/popular2-data.ts` queda como referencia del formato (ya no se usa en runtime).
