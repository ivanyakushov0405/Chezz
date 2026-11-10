# syntax=docker/dockerfile:1
# Образы Chezz (OPERATIONS §6.2; design E02 П9). Цели:
#   app   — apps/server + собранный apps/web (с .map), только prod-зависимости;
#   tools — весь workspace с dev-зависимостями (seed, tests/load).
# Сборка из корня репозитория:
#   docker build -f deploy/Dockerfile --target app --build-arg APP_VERSION=<git sha> .
# APP_VERSION — git SHA, не секрет. Секретов в ARG/ENV нет (SECURITY §17).

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Манифесты workspace: слой зависимостей не пересобирается при правке кода.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/chess/package.json packages/chess/
COPY packages/i18n/package.json packages/i18n/
COPY packages/protocol/package.json packages/protocol/

# Все зависимости (dev) и весь контекст сборки.
FROM manifests AS dev
RUN npm ci && npm cache clean --force
COPY . .

# Сборка SPA: apps/web/dist с source map (O22).
FROM dev AS web
RUN npm run build -w @chezz/web

# Дерево для цели app: prod-зависимости, сервер без тестов и скриптов, пакеты, dist.
FROM manifests AS runtime
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
COPY packages packages
COPY --from=web /app/apps/web/dist apps/web/dist
RUN find apps packages -path '*/node_modules' -prune -o -type f -name '*.test.ts' -exec rm -f {} + \
 && rm -rf packages/*/scripts

FROM base AS app
ARG APP_VERSION
ENV NODE_ENV=production HOST=0.0.0.0 METRICS_HOST=0.0.0.0 APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.revision=$APP_VERSION
COPY --from=runtime /app /app
RUN mkdir -p /data/screenshots && chown node:node /data/screenshots && chmod 700 /data/screenshots
USER node
EXPOSE 3000 9464
CMD ["node","--enable-source-maps","apps/server/src/main.ts"]

FROM dev AS tools
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.revision=$APP_VERSION
USER node
