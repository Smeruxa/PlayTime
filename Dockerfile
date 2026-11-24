FROM node:24-bookworm-slim AS node-base
WORKDIR /app

FROM node-base AS server-dependencies
WORKDIR /app/apps
COPY apps/package.json apps/package-lock.json ./
COPY apps/auth-api/package.json ./auth-api/package.json
COPY apps/chat-api/package.json ./chat-api/package.json
COPY apps/room-api/package.json ./room-api/package.json
COPY apps/gateway/package.json ./gateway/package.json
RUN npm ci --include=dev --no-audit --no-fund

FROM node-base AS server-runtime
WORKDIR /app/apps
ENV NODE_ENV=production \
    PLAYTIME_BACKEND_ROOT=/app/apps \
    PLAYTIME_SKIP_DOTENV=1
COPY --from=server-dependencies /app/apps/ ./
COPY apps/tsconfig.json ./
COPY apps/shared/ ./shared/
COPY apps/database/ ./database/
RUN install -d -o 1000 -g 1000 /app/apps/data
USER 1000:1000

FROM server-runtime AS auth-api
COPY apps/auth-api/ ./auth-api/
WORKDIR /app/apps/auth-api
EXPOSE 1511
CMD ["node", "--import", "tsx", "main.ts"]

FROM server-runtime AS chat-api
COPY apps/chat-api/ ./chat-api/
WORKDIR /app/apps/chat-api
EXPOSE 1512
CMD ["node", "--import", "tsx", "main.ts"]

FROM server-runtime AS room-api
COPY apps/room-api/ ./room-api/
WORKDIR /app/apps/room-api
EXPOSE 1513
CMD ["node", "--import", "tsx", "main.ts"]

FROM server-runtime AS database
CMD ["node", "--import", "tsx", "database/migrateCluster.ts"]

FROM node-base AS static-build
ARG WEB_API_ORIGIN
COPY package.json package-lock.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --legacy-peer-deps --no-audit --no-fund
COPY apps/site/package.json apps/site/package-lock.json ./apps/site/
RUN npm ci --prefix apps/site --no-audit --no-fund
COPY vite.web.config.mts tsconfig.json ./
COPY scripts/build-web-site.cjs ./scripts/
COPY apps/frontend/ ./apps/frontend/
COPY apps/shared/ ./apps/shared/
COPY apps/site/ ./apps/site/
RUN WEB_API_ORIGIN="$WEB_API_ORIGIN" npm run build:web-site

FROM server-runtime AS gateway
ENV PORT=1501 \
    LISTEN_HOST=0.0.0.0 \
    SKIP_SITE_BUILD=1 \
    SITE_DIST_PATH=/app/apps/site/dist
COPY apps/gateway/ ./gateway/
COPY --from=static-build /app/apps/site/dist/ ./site/dist/
WORKDIR /app/apps/gateway
EXPOSE 1501
CMD ["node", "--import", "tsx", "main.ts"]
