FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── deps stage ────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
RUN pnpm install --frozen-lockfile --filter backend... --filter @pharmerp/types --filter @pharmerp/utils

# ── build stage ───────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY backend/ ./backend/
RUN pnpm --filter @pharmerp/types build || true
RUN pnpm --filter @pharmerp/utils build || true
RUN pnpm --filter backend build

# ── runtime stage ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/packages ./packages

EXPOSE 4000
CMD ["node", "dist/main"]
