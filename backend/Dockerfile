FROM node:20-alpine AS base
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
RUN npm install -g pnpm@9
WORKDIR /app

# Copy root workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/config-typescript/package.json ./packages/config-typescript/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --filter backend... --prod

# Copy built files
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/packages ./packages

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "backend/dist/main"]