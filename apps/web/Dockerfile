# ============================================================
#  CICANET · Web (Next.js) — imagen multi-stage
#  - dev:  hot-reload (next dev) sobre código montado
#  - prod: build optimizado servido por next start
# ============================================================

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

# ---- dev: recarga en caliente ----
FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
# Polling para que Next detecte cambios en bind-mounts (Windows/macOS)
ENV WATCHPACK_POLLING=true
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod ----
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY package.json next.config.mjs ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://localhost:3000/login || exit 1
CMD ["npm", "start"]
