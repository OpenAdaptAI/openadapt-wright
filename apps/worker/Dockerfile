# =============================================================================
# Wright Worker -- Production Multi-Stage Dockerfile
#
# Stages:
#   1. deps    -- install pnpm + all workspace dependencies
#   2. build   -- compile TypeScript (shared + worker)
#   3. runtime -- minimal image with built artifacts + language runtimes
#
# Build context: repo root (run with `docker build -f apps/worker/Dockerfile .`)
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
COPY apps/worker/package.json apps/worker/

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
COPY apps/worker/tsconfig.json apps/worker/
COPY apps/worker/src/ apps/worker/src/

# Build shared first (turbo handles ordering via dependsOn)
RUN pnpm --filter @wright/shared build && pnpm --filter @wright/worker build

# Prune devDependencies for a leaner copy into runtime.
# Ensure sub-package node_modules dirs exist (they may be empty after prune
# if there are no production deps, but COPY needs them to exist).
RUN pnpm prune --prod \
    && mkdir -p packages/shared/node_modules apps/worker/node_modules

# ---------------------------------------------------------------------------
# Stage 3: Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

# ---- System packages ----
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        gnupg \
        openssh-client \
        # Python build deps (for repos that need to compile C extensions)
        python3 \
        python3-venv \
        python3-dev \
        build-essential \
        # Go (installed separately below, but needs basic deps)
        wget \
    && rm -rf /var/lib/apt/lists/*

# ---- GitHub CLI (gh) — needed for PR creation ----
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# ---- pnpm (for cloned JS/TS repos) ----
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ---- uv (fast Python package/project manager, includes python management) ----
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
# Pre-install Python 3.12 via uv so cloned repos can use it immediately
RUN uv python install 3.12

# ---- Go (latest stable) ----
ARG GO_VERSION=1.23.6
RUN wget -qO- "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    | tar -C /usr/local -xzf - \
    && rm -rf /tmp/*
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"

# ---- Rust / Cargo ----
ENV RUSTUP_HOME="/usr/local/rustup" \
    CARGO_HOME="/usr/local/cargo"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal \
    && chmod -R a+rX "$RUSTUP_HOME" "$CARGO_HOME"
ENV PATH="${CARGO_HOME}/bin:${PATH}"

# ---- npm (already in node:22-slim, but ensure latest) ----
RUN npm install -g npm@latest 2>/dev/null || true

# ---- Claude Code CLI (required by @anthropic-ai/claude-agent-sdk) ----
RUN npm install -g @anthropic-ai/claude-code

# ---- Application ----
WORKDIR /app

# Copy workspace manifests (needed for pnpm workspace resolution at runtime)
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./

# Copy shared package (built artifacts + package.json)
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/

# Copy worker (built artifacts + package.json)
COPY --from=build /app/apps/worker/package.json apps/worker/
COPY --from=build /app/apps/worker/dist/ apps/worker/dist/

# Copy production node_modules from pruned build stage
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/shared/node_modules/ packages/shared/node_modules/
COPY --from=build /app/apps/worker/node_modules/ apps/worker/node_modules/

# ---- Workspace directory for cloned repos ----
RUN mkdir -p /workspace
ENV WORKSPACE_DIR="/workspace"

# ---- Non-root user ----
RUN groupadd --gid 1001 wright \
    && useradd --uid 1001 --gid wright --shell /bin/bash --create-home wright \
    && chown -R wright:wright /app /workspace \
    # uv/go/cargo need writable dirs for the worker user
    && mkdir -p /home/wright/.cache /home/wright/go \
    && chown -R wright:wright /home/wright

# Adjust paths for non-root user
ENV GOPATH="/home/wright/go" \
    PATH="/home/wright/go/bin:/home/wright/.cargo/bin:/home/wright/.local/bin:${PATH}"

USER wright

WORKDIR /app/apps/worker

# Health check aligned with fly.toml
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
