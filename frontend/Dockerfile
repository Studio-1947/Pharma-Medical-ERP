FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── deps stage ────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/config-typescript/package.json ./packages/config-typescript/ 2>/dev/null || true
RUN pnpm install --frozen-lockfile --filter frontend... --filter @pharmerp/types

# ── build stage ───────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY frontend/ ./frontend/
RUN pnpm --filter @pharmerp/types build || true
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter frontend build

# ── runtime stage ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=build /app/frontend/public ./public
COPY --from=build --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/frontend/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
