# =============================================================================
# Wright Bot -- Production Multi-Stage Dockerfile
#
# Stages:
#   1. deps    -- install pnpm + all workspace dependencies
#   2. build   -- compile TypeScript (shared + bot)
#   3. runtime -- minimal image with built artifacts
#
# Build context: repo root (run with `docker build -f apps/bot/Dockerfile .`)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy only what pnpm needs for dependency resolution (layer cache)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bot/package.json apps/bot/

# Install all deps (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile || pnpm install

# ---------------------------------------------------------------------------
# Stage 2: Build TypeScript
# ---------------------------------------------------------------------------
FROM deps AS build

# Copy source files
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY apps/bot/tsconfig.json apps/bot/
COPY apps/bot/src/ apps/bot/src/

# Build shared first, then bot
RUN pnpm --filter @wright/shared build && pnpm --filter @wright/bot build

# Prune devDependencies for a leaner copy into runtime.
RUN pnpm prune --prod \
    && mkdir -p packages/shared/node_modules apps/bot/node_modules

# ---------------------------------------------------------------------------
# Stage 3: Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app

# Copy workspace manifests (needed for pnpm workspace resolution at runtime)
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./

# Copy shared package (built artifacts + package.json)
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/

# Copy bot (built artifacts + package.json)
COPY --from=build /app/apps/bot/package.json apps/bot/
COPY --from=build /app/apps/bot/dist/ apps/bot/dist/

# Copy production node_modules from pruned build stage
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/shared/node_modules/ packages/shared/node_modules/
COPY --from=build /app/apps/bot/node_modules/ apps/bot/node_modules/

# Non-root user
RUN groupadd --gid 1001 wright \
    && useradd --uid 1001 --gid wright --shell /bin/bash --create-home wright \
    && chown -R wright:wright /app

USER wright

WORKDIR /app/apps/bot

CMD ["node", "dist/index.js"]
