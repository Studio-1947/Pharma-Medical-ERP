FROM node:20-bullseye AS base
RUN npm install -g pnpm@9

FROM base AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/config-typescript/package.json ./packages/config-typescript/
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY backend/ ./backend/
RUN pnpm --filter @pharmerp/types build || true
RUN pnpm --filter @pharmerp/utils build || true
RUN pnpm --filter backend build
RUN pnpm deploy --filter backend --prod /deploy

FROM node:20-bullseye-slim AS runner
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /deploy .
# Migration SQL is read at boot by runMigrations(); guarantee it's present
# regardless of what `pnpm deploy` prunes.
COPY --from=build /app/backend/drizzle ./drizzle
COPY --from=build /app/backend/scripts ./scripts
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/main"]