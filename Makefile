# ============================================================
#  CICANET · Atajos del stack Docker
#  Uso: make up | make logs | make down ...
#  (En Windows sin `make`, usa los equivalentes npm: npm run up, etc.)
# ============================================================
.PHONY: up dev down stop logs ps rebuild reset api-logs web-logs sh-api sh-web tunnel help

## Levanta todo el stack en segundo plano (construye si hace falta)
up:
	docker compose up -d --build

## Levanta todo en primer plano con logs en vivo
dev:
	docker compose up --build

## Detiene y elimina contenedores (conserva datos)
down:
	docker compose down

## Pausa los contenedores sin eliminarlos
stop:
	docker compose stop

## Logs de todos los servicios (Ctrl+C para salir)
logs:
	docker compose logs -f

## Estado de los servicios
ps:
	docker compose ps

## Reconstruye imágenes desde cero (sin cache)
rebuild:
	docker compose build --no-cache

## ⚠️ Borra TODO incluyendo volúmenes (base de datos, MinIO)
reset:
	docker compose down -v

api-logs:
	docker compose logs -f api

web-logs:
	docker compose logs -f web

## Shell dentro del contenedor de la API
sh-api:
	docker compose exec api sh

## Shell dentro del contenedor de la Web
sh-web:
	docker compose exec web sh

## Abre un túnel público con ngrok (expone web + API por mismo origen)
tunnel:
	powershell -ExecutionPolicy Bypass -File scripts/tunnel.ps1 -Up

help:
	@echo "Targets: up dev down stop logs ps rebuild reset api-logs web-logs sh-api sh-web tunnel"
