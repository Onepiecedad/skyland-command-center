# SCC Dockerfile — Multi-stage build: Frontend + Backend
# Serves both the React SPA and the Express API from a single container.

# ── Stage 1: Build Frontend ──────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ ./

# Gateway-token bakas in i bundlen (Render exponerar env som build-args när ARG deklareras).
# OBS: värdet blir publikt i JS-bundlen — acceptabelt eftersom gatewayen inte är nåbar
# från internet: den binder loopback på VPS:en och exponeras bara över Tailscale, så
# token är värdelös utan en enhet i tailnätet.
ARG VITE_GATEWAY_TOKEN=
ENV VITE_GATEWAY_TOKEN=$VITE_GATEWAY_TOKEN

# Gatewayns adress. VARJE VITE_-variabel måste deklareras som ARG här — annars når
# den aldrig vite-bygget, oavsett vad som står i Renders Environment. Det var därför
# bundlen fortsatte peka på localhost efter Tailscale-flytten 31 aug.
ARG VITE_GATEWAY_URL=
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
ARG VITE_GATEWAY_HTTP=
ENV VITE_GATEWAY_HTTP=$VITE_GATEWAY_HTTP

# Build the Vite React app → dist/
RUN npm run build

# ── Stage 2: Build Backend ───────────────────────────────────────────
FROM node:20-alpine AS backend-builder

WORKDIR /app

COPY backend/package*.json ./
COPY backend/tsconfig.json ./

# Install all deps (tsc + types needed for compilation)
RUN npm ci

COPY backend/src ./src

# Compile TypeScript → dist/
RUN npm run build

# ── Stage 3: Production ─────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Commit-sha bakas in så /health kan svara på VILKEN commit som kör.
# Render exponerar env som build-args när ARG deklareras (samma mekanism som
# VITE_GATEWAY_TOKEN ovan). Sätts den inte faller koden tillbaka på runtime-env.
ARG RENDER_GIT_COMMIT=
ENV GIT_COMMIT=$RENDER_GIT_COMMIT

COPY backend/package*.json ./

# Production deps only
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled backend from builder
COPY --from=backend-builder /app/dist ./dist

# Copy built frontend into public/ for express.static
COPY --from=frontend-builder /app/frontend/dist ./public

RUN mkdir -p logs

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health/live', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
