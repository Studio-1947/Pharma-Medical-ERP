FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@9

# ── deps stage ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/config-typescript/package.json ./packages/config-typescript/
RUN pnpm install --frozen-lockfile --filter backend... --filter @pharmerp/types --filter @pharmerp/utils

# ── build stage ────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY backend/ ./backend/
RUN pnpm --filter @pharmerp/types build || true
RUN pnpm --filter @pharmerp/utils build || true
RUN pnpm --filter backend build

# ── runtime stage ──────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@9
WORKDIR /app

# Copy everything from build — no reinstall needed
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/packages ./packages

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/main"]FROM node:20-bullseye AS base
RUN npm install -g pnpm@9

# ── deps stage ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/config-typescript/package.json ./packages/config-typescript/
RUN pnpm install --frozen-lockfile --filter backend... --filter @pharmerp/types --filter @pharmerp/utils

# ── build stage ────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY backend/ ./backend/
RUN pnpm --filter @pharmerp/types build || true
RUN pnpm --filter @pharmerp/utils build || true
RUN pnpm --filter backend build

# ── runtime stage ──────────────────────────────────────────
FROM node:20-bullseye-slim AS runner
RUN npm install -g pnpm@9
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/packages ./packages

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/main"]