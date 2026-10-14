# syntax=docker/dockerfile:1.7
#
# Build locally; nothing in this repository publishes an image.
#   docker build -t replay-kit .                      # image without Chromium and ffmpeg: viewer + upload API
#   docker build -t replay-kit:render --build-arg WITH_RENDER=1 .   # + server-side video export and list posters
#
# WITH_RENDER=1 adds a headless Chromium and ffmpeg (several hundred MB). Without it the render routes answer 503
# and the viewer hides "Export video".
ARG WITH_RENDER=0
ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# Production dependencies only (the server runs from TypeScript sources with Node's type stripping).
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# The viewer: Vite output in dist/client.
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Chromium for the render variant, pinned by the locked playwright-core version.
FROM base AS browser
COPY --from=deps /app/node_modules ./node_modules
RUN PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node node_modules/playwright-core/cli.js install --only-shell chromium \
    && ln -s "$(find /ms-playwright -type f -name chrome-headless-shell | head -n 1)" /ms-playwright/chrome-headless-shell

FROM node:${NODE_VERSION}-bookworm-slim AS runtime-0
ENV RENDER_DISABLED=1

FROM node:${NODE_VERSION}-bookworm-slim AS runtime-1
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ffmpeg fontconfig fonts-noto-core fonts-liberation \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
      libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
      libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=browser /ms-playwright /ms-playwright
# Chromium's sandbox needs unprivileged user namespaces, which default container seccomp profiles block. The image
# runs it with --no-sandbox and relies on the container (unprivileged user, no added capabilities, a browser that
# only loads the loopback render page). Set CHROMIUM_NO_SANDBOX=0 where the runtime allows user namespaces.
ENV CHROMIUM_PATH=/ms-playwright/chrome-headless-shell FFMPEG_PATH=/usr/bin/ffmpeg CHROMIUM_NO_SANDBOX=1

FROM runtime-${WITH_RENDER} AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Replay Kit" \
      org.opencontainers.image.description="Self-hostable viewer and upload API for browser session replays (rrweb, steps, console, network, performance)." \
      org.opencontainers.image.source="https://github.com/hazem3500/replay-kit" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data SERVICE_VERSION=$VERSION
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node src/server ./src/server
COPY --chown=node:node src/shared ./src/shared
COPY --chown=node:node src/capture ./src/capture
COPY --chown=node:node src/client/render/frames.ts ./src/client/render/frames.ts
COPY --chown=node:node sample ./sample
COPY --chown=node:node examples ./examples
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/server/main.ts"]
