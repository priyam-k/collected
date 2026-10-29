# node:24-bookworm-slim, pinned to the multi-arch index digest (same tag, immutable). Refresh with:
#   docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
RUN npm i -g pnpm@12.3.4
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY shared/package.json shared/
COPY core/package.json core/
COPY server/package.json server/
COPY web/package.json web/
COPY agent/package.json agent/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# web and server build in separate stages: a server-only change reuses the cached Vite build (the heavy one on a 1 GB box).
FROM deps AS build-web
COPY tsconfig.base.json ./
COPY shared ./shared
COPY web ./web
# vite only: `pnpm --filter web build` also runs `tsc --noEmit`, which needs ~500 MB and stalled for 15+ minutes on the
# 1 GB e2-micro. Type-check locally (`pnpm -r typecheck`) before building an image.
RUN pnpm --filter web exec vite build

FROM deps AS build-server
COPY tsconfig.base.json ./
COPY shared ./shared
COPY core ./core
COPY server ./server
# tsup bundles @collected/shared and @collected/core into dist/index.js; their runtime packages are server dependencies
# too, so the deploy below puts them in /out/server/node_modules where the bundle resolves them.
RUN pnpm --filter @collected/server build
RUN pnpm --filter @collected/server --prod --legacy deploy /out/server

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
# Which commit this image was built from, for /api/system/version and the update check (core/src/lib/version.ts).
# .github/workflows/image.yml passes both; a local `docker build` without them reports "dev" and the check stays quiet.
ARG GIT_SHA=dev
ARG BUILT_AT=
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data \
    WEB_DIST=/app/web/dist SEED_CONFIG_PATH=/app/artifacts/seed-config.json \
    MIGRATIONS_DIR=/app/core/drizzle \
    COLLECTED_COMMIT=$GIT_SHA
WORKDIR /app
COPY --from=build-server /out/server /app/server
# The migrations are read at boot (core/src/db/migrate.ts); only the SQL and the journal are needed, not core's source.
COPY --from=build-server /app/core/drizzle /app/core/drizzle
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "$GIT_SHA" "$BUILT_AT" > /app/server/build-info.json
COPY --from=build-web /app/web/dist /app/web/dist
COPY artifacts/seed-config.json /app/artifacts/seed-config.json
COPY package.json /app/package.json
# /app stays root-owned and world-readable: the runtime user reads its code, it must not be able to rewrite it.
# Only /data (the bind mount; database, key file, pre-migration snapshots) belongs to node.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
