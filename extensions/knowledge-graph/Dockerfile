# ──────────────────────────────────────────────────────────────────────────────
# Infrastructure Knowledge Graph — Production Dockerfile
#
# Multi-stage build:
#   1. base      — shared Node 22 Alpine + pnpm setup
#   2. deps      — install production + dev dependencies (for build)
#   3. build     — compile TypeScript
#   4. prod-deps — install production-only dependencies
#   5. runtime   — minimal final image with dist + prod deps
#
# Native deps: better-sqlite3 requires node-gyp → python3 + build-base
#
# Usage:
#   docker build -t infra-graph .
#   docker run -p 8080:8080 -v ./data:/data infra-graph serve --port 8080 --db /data/infra.db
#   docker run infra-graph mcp --db /data/infra.db
# ──────────────────────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 1: Base — Node 22 Alpine + pnpm
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS base

# Install pnpm via corepack (matches CI)
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 2: Dependencies — install all deps (including devDependencies for build)
# ═══════════════════════════════════════════════════════════════════════════════
FROM base AS deps

# Native build tools for better-sqlite3
RUN apk add --no-cache python3 make g++ gcc

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 3: Build — compile TypeScript to dist/
# ═══════════════════════════════════════════════════════════════════════════════
FROM deps AS build

COPY tsconfig.json ./
COPY src/ src/

RUN pnpm build

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 4: Production dependencies only
# ═══════════════════════════════════════════════════════════════════════════════
FROM base AS prod-deps

RUN apk add --no-cache python3 make g++ gcc

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 5: Runtime — minimal production image
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS runtime

# Security: run as non-root
RUN addgroup -g 1001 -S infragraph && \
    adduser -S infragraph -u 1001 -G infragraph

# Runtime native lib for better-sqlite3
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy compiled output
COPY --from=build /app/dist ./dist

# Copy package.json for version info
COPY package.json ./

# Create data directory for SQLite databases
RUN mkdir -p /data && chown infragraph:infragraph /data

# Switch to non-root user
USER infragraph

# Default environment
ENV NODE_ENV=production
ENV INFRA_GRAPH_DB=/data/infra.db
ENV INFRA_GRAPH_HOST=0.0.0.0
ENV INFRA_GRAPH_PORT=8080

# Health check — hit the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${INFRA_GRAPH_PORT}/health || exit 1

# Expose HTTP API port
EXPOSE 8080

# Persistent volume for SQLite data
VOLUME ["/data"]

# Default entrypoint: start the HTTP API server
ENTRYPOINT ["node", "dist/bin/infra-graph.js"]
CMD ["serve", "--port", "8080", "--host", "0.0.0.0", "--db", "/data/infra.db"]
