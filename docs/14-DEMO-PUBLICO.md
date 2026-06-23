# CICANET · Demo público en vivo (VISIONYX Telecom)

> Permite que **cualquiera desde `visionyx.lat`** pruebe la plataforma con un botón,
> igual que VISIONYX Access. El sitio llama a un endpoint que genera **credenciales
> temporales**; el visitante entra a la web de cicanet y explora con datos de ejemplo.
> Al expirar el TTL, el usuario efímero se borra solo.

**Estado:** implementado en backend + web + sitio (2026-06-23). El despliegue de
infraestructura (subdominio, nginx, TLS) es trabajo de servidor, no de código.

## Cómo funciona (flujo)

```
visionyx.lat/demo-cicanet.html               demo-telecom.visionyx.lat
  [⚡ Generar acceso] ──POST /api/demo/session──▶  API cicanet (DEMO_MODE=true)
                       ◀── { username, password, ttlMinutes, expiresAt, appUrl }
  muestra credenciales + contador
  [Abrir la plataforma →] ───────────────────▶  /login (web cicanet) → explora
                                                  (barredor elimina el usuario al expirar)
```

- **Endpoint:** `POST /api/demo/session` (público, sin auth a propósito). Crea un
  `Usuario` efímero `demo_xxxxxxxx` con contraseña aleatoria y rol `DEMO_ROLE`
  (por defecto `admin`, para mostrar toda la plataforma incluida la cabina contable).
- **`GET /api/demo/status`** → `{ enabled, ttlMinutes }` (por si el sitio quiere ocultar
  el botón cuando el demo está apagado).
- **Barredor:** cada `DEMO_SWEEP_SECONDS` elimina los `demo_*` con más de `DEMO_TTL_MINUTES`.
- **Tope:** `DEMO_MAX_ACTIVE_SESSIONS` (responde 503 si se supera).

## Seguridad (importante)

- El endpoint **solo existe funcionalmente con `DEMO_MODE=true`**. En el ISP real
  queda en `false` y responde **403** (no se crean cuentas staff sin auth). Es el
  guardarraíl principal: NUNCA poner `DEMO_MODE=true` en el entorno productivo real.
- El usuario demo es **efímero** (TTL) y de **datos compartidos** ficticios: cicanet es
  single-tenant, así que todos los visitantes ven el MISMO dataset de ejemplo (a
  diferencia de Access, que aísla por colección de rostros). Por eso el demo va en un
  **despliegue/BD aparte** y conviene **reiniciar los datos por cron** (ver abajo).
- No publicar el backend del demo directo: detrás de nginx (loopback), como Access.

## Despliegue (servidor)

1. **DNS:** `demo-telecom.visionyx.lat` → IP del servidor. TLS con certbot:
   `certbot --nginx -d demo-telecom.visionyx.lat`.

2. **Stack de demo aislado** (BD propia, no la productiva). En su `.env`:
   ```env
   DEMO_MODE=true
   DEMO_TTL_MINUTES=60
   DEMO_MAX_ACTIVE_SESSIONS=40
   DEMO_SWEEP_SECONDS=60
   DEMO_ROLE=admin
   DEMO_APP_URL=https://demo-telecom.visionyx.lat
   CORS_ORIGINS=https://demo-telecom.visionyx.lat,https://visionyx.lat,https://www.visionyx.lat
   NEXT_PUBLIC_API_URL=https://demo-telecom.visionyx.lat/api
   ```
   (No publicar puertos al host; solo loopback. `docker compose up -d --build`.)

3. **nginx** (`demo-telecom.visionyx.lat`): la web (Next) y la API en el mismo origen:
   ```nginx
   server {
     listen 443 ssl;
     server_name demo-telecom.visionyx.lat;
     ssl_certificate     /etc/letsencrypt/live/demo-telecom.visionyx.lat/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/demo-telecom.visionyx.lat/privkey.pem;

     # API NestJS (loopback)
     location /api/      { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
     location /realtime/ { proxy_pass http://127.0.0.1:4000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $host; }
     # Web Next (loopback)
     location /          { proxy_pass http://127.0.0.1:3080; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```

4. **Reset periódico de datos** (cron, recomendado por ser dataset compartido):
   ```cron
   0 */6 * * *  cd ~/cicanet-demo && docker compose exec -T postgres psql -U cicanet -d cicanet -f /seed/reset-demo.sql
   ```
   (o re-sembrar el dataset de ejemplo). Los usuarios `demo_*` ya se barren solos por TTL.

5. **Sitio:** en `website/demo-cicanet.html` ajustar (si cambia el dominio):
   ```js
   var API = 'https://demo-telecom.visionyx.lat/api';
   var APP = 'https://demo-telecom.visionyx.lat';
   ```
   El botón ya está activo en la tarjeta **Telecom** de `index.html`.

## Verificación

```bash
# Apagado (ISP real): 403
curl -s -X POST https://<host>/api/demo/session        # 403 Forbidden
# Encendido (demo):
curl -s https://demo-telecom.visionyx.lat/api/demo/status            # {"enabled":true,...}
curl -s -X POST https://demo-telecom.visionyx.lat/api/demo/session   # {username,password,expiresAt,...}
```

## Referencias

- Backend: `apps/api/src/demo/` + helpers en `apps/api/src/users/users.service.ts`.
- Config: `apps/api/src/config.ts` (bloque `demo`) · `docker-compose.yml` (env `DEMO_*`).
- Sitio: `access/website/demo-cicanet.html` + tarjeta Telecom en `index.html`.
- Patrón de referencia: demo de Access (`access/deploy-demo.sh`, `website/demo.html`).
