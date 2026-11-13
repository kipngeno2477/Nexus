# Nexus: cited RAG over public law. One container: Express API + built React frontend.
# PrimeCloud: GitHub auto-deploy, Dockerfile path "Dockerfile", container port 8080,
# health check path /healthz. Secrets (LLM_API_KEY etc.) are set in the console, never baked in.

# ---------- 1. Build the frontend ----------
FROM node:22-alpine AS frontend
WORKDIR /app/Frontend
COPY Frontend/package.json Frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY Frontend/ ./
RUN npm run build

# ---------- 2. Install backend production dependencies ----------
FROM node:22-alpine AS backend-deps
WORKDIR /app/Backend
COPY Backend/package.json Backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3. Runtime ----------
FROM node:22-alpine
# NODE_OPTIONS keeps V8's heap under the container's hard memory limit (cgroups, no swap).
# 384 MB suits a 512 MiB container; raise it if you add RAM.
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app/Backend

COPY --from=backend-deps /app/Backend/node_modules ./node_modules
COPY Backend/package.json ./
COPY Backend/server.js ./
COPY Backend/src ./src
COPY Backend/controllers ./controllers
COPY Backend/routes ./routes
COPY Backend/middleware ./middleware
# The bundled knowledge base (original documents + source metadata), ingested at startup
COPY Backend/data/raw ./data/raw
COPY Backend/data/sources.json ./data/sources.json
COPY --from=frontend /app/Frontend/dist /app/Frontend/dist

# Run as the unprivileged "node" user that ships with the image
USER node
EXPOSE 8080
CMD ["node", "server.js"]
