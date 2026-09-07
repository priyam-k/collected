FROM node:24-bookworm-slim AS base
RUN npm i -g pnpm@12.3.4
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# web and server build in separate stages: a server-only change reuses the cached Vite build (the heavy one on a 1 GB box).
FROM deps AS build-web
COPY tsconfig.base.json ./
COPY shared ./shared
COPY web ./web
RUN pnpm --filter web build

FROM deps AS build-server
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
RUN pnpm --filter server build
RUN pnpm --filter server --prod --legacy deploy /out/server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data \
    WEB_DIST=/app/web/dist SEED_CONFIG_PATH=/app/artifacts/seed-config.json
WORKDIR /app
COPY --from=build-server /out/server /app/server
COPY --from=build-web /app/web/dist /app/web/dist
COPY artifacts/seed-config.json /app/artifacts/seed-config.json
COPY package.json /app/package.json
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
