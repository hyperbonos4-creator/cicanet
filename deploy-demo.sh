#!/usr/bin/env bash
# Despliegue del DEMO público de VISIONYX Telecom (cicanet) en el servidor.
# Genera el .env del stack de demo (DEMO_MODE=true, secretos propios), restringe
# los puertos de API y Web a loopback (nginx hace de proxy público) y levanta el
# stack. Pensado para un CLON DEDICADO con BD propia (no el ISP real).
#
# Uso (en el servidor):  bash deploy-demo.sh
# Variables opcionales:  DEMO_DIR=~/cicanet-demo  DEMO_DOMAIN=demo-telecom.visionyx.lat
#
# Después: configurar nginx + TLS para el subdominio (ver docs/14-DEMO-PUBLICO.md).
set -euo pipefail

DEMO_DIR="${DEMO_DIR:-$HOME/cicanet-demo}"
DOMAIN="${DEMO_DOMAIN:-demo-telecom.visionyx.lat}"
cd "$DEMO_DIR"

echo "== 1) Generar .env del stack de demo (secretos propios, NO los de producción) =="
cat > .env <<EOF
# ---- Stack de DEMOSTRACIÓN (aislado del ISP real) ----
POSTGRES_USER=cicanet
POSTGRES_PASSWORD=$(openssl rand -hex 12)
POSTGRES_DB=cicanet
JWT_ACCESS_SECRET=$(openssl rand -hex 24)
JWT_REFRESH_SECRET=$(openssl rand -hex 24)
SEED_ADMIN_USER=admin
SEED_ADMIN_PASS=$(openssl rand -hex 8)

# Demo público efímero
DEMO_MODE=true
DEMO_TTL_MINUTES=60
DEMO_MAX_ACTIVE_SESSIONS=40
DEMO_SWEEP_SECONDS=60
DEMO_ROLE=admin
DEMO_APP_URL=https://${DOMAIN}

# CORS: el sitio de la empresa + el propio demo
CORS_ORIGINS=https://${DOMAIN},https://visionyx.lat,https://www.visionyx.lat
NEXT_PUBLIC_API_URL=https://${DOMAIN}/api
NEXT_PUBLIC_SOCKET_URL=https://${DOMAIN}/realtime
EOF
echo "   .env escrito en $DEMO_DIR/.env"

echo "== 2) Restringir API (4000) y Web (3080) a loopback =="
# nginx publica el subdominio; los contenedores solo escuchan en 127.0.0.1.
sed -i 's/"4000:4000"/"127.0.0.1:4000:4000"/' docker-compose.yml || true
sed -i 's/"3080:3000"/"127.0.0.1:3080:3000"/' docker-compose.yml || true

echo "== 3) Levantar el stack =="
docker compose up -d --build

echo "== 4) Estado =="
sleep 6
docker compose ps || true

echo
echo "OK: demo levantado con DEMO_MODE=true."
echo "  - Verifica:  curl -s http://127.0.0.1:4000/api/demo/status   # {\"enabled\":true,...}"
echo "  - Falta:     subdominio ${DOMAIN} + TLS + bloque nginx (ver docs/14-DEMO-PUBLICO.md)."
echo "  - Reset de datos por cron recomendado (dataset de demo compartido)."
