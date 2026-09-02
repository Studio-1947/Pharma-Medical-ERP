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
# The backend uses PORT=4000 in the shared production environment. The
# frontend is a separate upstream and must remain on nginx's configured 3000.
ENV PORT=3000

COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

# Immutable copy of exactly this build's assets. The entrypoint restores older
# builds' assets into .next/static so this container can serve them, which means
# .next/static is no longer a trustworthy record of what this build shipped.
# Publishing from this pristine copy instead keeps retention honest: restored
# assets are never re-published, so they still age out on schedule.
COPY --from=build /app/frontend/.next/static ./frontend/.next/static-pristine

# Merges this build's hashed assets into the retention volume before the server
# starts, so clients still running a previous build can resolve their chunks.
# chmod is applied here rather than relying on the committed file mode, because
# the repo is authored on Windows where the executable bit is not preserved.
COPY frontend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "frontend/server.js"]
