# Stage 1: Build the TypeScript worker
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./

# Copy package manifests for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/worker/ apps/worker/

# Build shared package first, then worker
RUN pnpm --filter @wright/shared build && pnpm --filter @wright/worker build

# Stage 2: Runtime with Node.js + Python (for running target repo tests)
FROM node:22-slim AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install Python 3.12 and uv for running target repo tests (pytest, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install additional language runtimes/tools as needed
# Go, Rust, etc. can be added here for broader test runner support

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy built artifacts and production dependencies
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/apps/worker/package.json apps/worker/
COPY --from=builder /app/apps/worker/dist/ apps/worker/dist/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# Working directory for cloned repos
RUN mkdir -p /workspace
ENV WORKSPACE_DIR="/workspace"

WORKDIR /app/apps/worker

CMD ["node", "dist/index.js"]
