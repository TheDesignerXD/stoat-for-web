# Dockerfile for building a custom Stoat web client with push notification support.
# Place this file in the root of your stoat-for-web fork.
#
# Build with: docker build -t stoat-web-custom .
# The resulting image serves the static site on port 5000 (matching the upstream image).

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

# Install pnpm and mise dependencies
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
RUN apk add --no-cache git python3 make g++

WORKDIR /app

# Copy package files first for better layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json packages/client/
COPY packages/stoat.js/package.json packages/stoat.js/ 2>/dev/null || true
COPY packages/lingui-solid/babel-plugin-extract-messages/package.json packages/lingui-solid/babel-plugin-extract-messages/ 2>/dev/null || true
COPY packages/lingui-solid/babel-plugin-lingui-macro/package.json packages/lingui-solid/babel-plugin-lingui-macro/ 2>/dev/null || true
COPY packages/lingui-solid/solid/package.json packages/lingui-solid/solid/ 2>/dev/null || true
COPY packages/solid-livekit-components/package.json packages/solid-livekit-components/ 2>/dev/null || true

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy all source files
COPY . .

# Build workspace dependencies first, then the client
RUN pnpm --filter stoat.js run build 2>/dev/null || true
RUN pnpm --filter @lingui-solid/babel-plugin-extract-messages run build 2>/dev/null || true
RUN pnpm --filter @lingui-solid/babel-plugin-lingui-macro run build 2>/dev/null || true
RUN pnpm --filter @lingui-solid/solid run build 2>/dev/null || true
RUN pnpm --filter solid-livekit-components run build 2>/dev/null || true
RUN pnpm --filter client run build 2>/dev/null || \
    cd packages/client && npx vite build

# --- Stage 2: Serve ---
FROM node:20-alpine

RUN npm install -g serve

WORKDIR /app

COPY --from=builder /app/packages/client/dist ./dist

EXPOSE 5000

CMD ["serve", "-s", "dist", "-l", "5000"]
