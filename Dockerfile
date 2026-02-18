# Dockerfile for building a custom Stoat web client with push notification support.
# Place this file in the root of your stoat-for-web fork.
#
# Build with: docker build -t stoat-web-custom .
# The resulting image serves the static site on port 5000 (matching the upstream image).

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

# Install pnpm and build dependencies
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
RUN apk add --no-cache git python3 make g++

WORKDIR /app

# Copy entire repo (simplest approach for monorepo with many packages)
COPY . .

# Install all dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Build all workspace packages in dependency order
# Using recursive build ensures stoat.js and other deps build before client
RUN pnpm -r run build || (cd packages/client && npx vite build)

# --- Stage 2: Serve ---
FROM node:20-alpine

RUN npm install -g serve

WORKDIR /app

COPY --from=builder /app/packages/client/dist ./dist

EXPOSE 5000

CMD ["serve", "-s", "dist", "-l", "5000"]
