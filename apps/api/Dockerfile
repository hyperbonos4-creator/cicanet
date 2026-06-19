# ============================================================
#  CICANET · API (NestJS) — imagen multi-stage
#  - dev:  hot-reload (nest --watch) sobre código montado
#  - prod: imagen liviana que corre dist/main.js
# ============================================================

# ---- deps: instala dependencias (cacheable) ----
FROM node:20-alpine AS deps
WORKDIR /app
# Prisma necesita openssl en Alpine para el engine (musl + OpenSSL 3).
RUN apk add --no-cache openssl
COPY package.json ./
# El schema debe estar presente para que `prisma generate` produzca el client.
COPY prisma ./prisma
RUN npm install --no-audit --no-fund
RUN npx prisma generate

# ---- dev: desarrollo con recarga en caliente ----
FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
RUN apk add --no-cache openssl
# Polling: necesario para que el watcher detecte cambios en bind-mounts (Windows/macOS)
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=400
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- build: compila TypeScript → dist ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod: solo runtime + dist ----
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --no-audit --no-fund
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "dist/main.js"]
