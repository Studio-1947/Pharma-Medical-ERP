FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/config-typescript/package.json ./packages/config-typescript/
RUN pnpm install --frozen-lockfile --filter frontend... --filter @pharmerp/types --filter @pharmerp/utils

FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY frontend/ ./frontend/
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @pharmerp/types build || true
RUN pnpm --filter @pharmerp/utils build || true
RUN pnpm --filter frontend build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

EXPOSE 3000
CMD ["node", "frontend/server.js"]