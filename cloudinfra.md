# PharmERP — Cloud Infrastructure & Production Deployment Guide

> Stack: NestJS (Fastify) backend · Next.js 15 frontend · PostgreSQL 16 · Redis 7 · Cloudflare R2 · BullMQ
> Monorepo: Turborepo + pnpm workspaces

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Cloudflare                         │
│   DNS · SSL termination · DDoS protection · Proxy       │
└────────┬───────────────────────────┬────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐       ┌──────────────────────┐
│   Vercel        │       │   Railway / VPS       │
│   (frontend)    │       │   (backend API)       │
│   Next.js 15    │       │   NestJS + Fastify    │
│   port 3000     │       │   port 4000           │
└─────────────────┘       └──────────┬────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
   ┌─────────────────┐  ┌─────────────────────┐  ┌───────────────────┐
   │  Neon / Supabase│  │   Upstash Redis     │  │  Cloudflare R2    │
   │  PostgreSQL 16  │  │   (cache + BullMQ)  │  │  (file storage)   │
   │  (Mumbai/Sing.) │  │   (Mumbai region)   │  │  (global CDN)     │
   └─────────────────┘  └─────────────────────┘  └───────────────────┘
```

---

## 2. Provider Decisions

| Service | Provider | Why | Monthly cost (est.) |
|---|---|---|---|
| Frontend | **Vercel** | Zero-config Next.js, global CDN, preview deploys | Free → $20 Pro |
| Backend API | **Railway** | Docker deploys, Mumbai region (via AWS ap-south-1), autoscale | $5–25 |
| PostgreSQL | **Neon** | Serverless PG, Mumbai region, connection pooling built-in, free tier | Free → $19 |
| Redis | **Upstash** | Serverless Redis, Mumbai, pay-per-request, zero idle cost | Free → $10 |
| Object storage | **Cloudflare R2** | S3-compatible, zero egress fees, global CDN | ~$0.015/GB |
| DNS + SSL | **Cloudflare** | Free plan, proxy mode hides origin IP, auto-SSL | Free |
| CI/CD | **GitHub Actions** | Already in your repo, 2000 min/month free | Free |
| Monitoring | **Better Stack** | Uptime + log management, generous free tier | Free → $24 |

**Total estimated: $25–80/month** for a typical 1–3 branch pharmacy.

> For 5+ branches or on-premise requirements, see Section 10 (VPS option).

---

## 3. Prerequisites

Before starting:

- [ ] Domain purchased (e.g., `pharmerp.yourpharmacy.in`)
- [ ] GitHub repo with all code pushed
- [ ] Accounts created: Vercel, Railway, Neon, Upstash, Cloudflare, Better Stack
- [ ] `pnpm` installed locally
- [ ] Docker installed locally (for testing prod builds)

---

## 4. Dockerfiles

### 4.1 Backend Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── deps stage ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
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

COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/packages ./packages

ENV NODE_ENV=production
EXPOSE 4000

# Run migrations then start
CMD ["sh", "-c", "node dist/main"]
```

### 4.2 Frontend Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── deps stage ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
RUN pnpm install --frozen-lockfile --filter frontend... --filter @pharmerp/types --filter @pharmerp/utils

# ── build stage ────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY packages/ ./packages/
COPY frontend/ ./frontend/
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter frontend build

# ── runtime stage ──────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./.next/static
COPY --from=build /app/frontend/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

> Add `output: 'standalone'` to `frontend/next.config.ts` so Next.js bundles its own server:
>
> ```ts
> const nextConfig: NextConfig = {
>   output: 'standalone',
>   transpilePackages: ["@pharmerp/types"],
>   experimental: { typedRoutes: true },
> };
> ```

### 4.3 `.dockerignore` (place at repo root)

```
node_modules
**/node_modules
**/.next
**/dist
**/.turbo
.git
*.md
.env*
```

---

## 5. Production docker-compose (self-hosted / VPS fallback)

Create `docker-compose.prod.yml` at the repo root:

```yaml
version: "3.9"

services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_BUCKET: ${S3_BUCKET}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_REGION: auto
      CORS_ORIGIN: ${CORS_ORIGIN}
      PORT: 4000
    ports:
      - "4000:4000"
    depends_on:
      - postgres
      - redis

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: pharmerp
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - backend
      - frontend

volumes:
  postgres_data:
  redis_data:
```

### 5.1 Nginx config (`nginx.conf`)

```nginx
events { worker_connections 1024; }

http {
  upstream api   { server backend:4000; }
  upstream web   { server frontend:3000; }

  # Redirect HTTP → HTTPS
  server {
    listen 80;
    server_name api.yourdomain.in yourdomain.in;
    return 301 https://$host$request_uri;
  }

  # API subdomain
  server {
    listen 443 ssl;
    server_name api.yourdomain.in;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.in/privkey.pem;

    client_max_body_size 20M;

    location / {
      proxy_pass http://api;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 60s;
    }
  }

  # Frontend
  server {
    listen 443 ssl;
    server_name yourdomain.in www.yourdomain.in;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.in/privkey.pem;

    location / {
      proxy_pass http://web;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
    }
  }
}
```

---

## 6. Environment Variables

### Backend `.env.production`

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `4000` | |
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx.neon.tech/pharmerp?sslmode=require` | Neon connection string |
| `REDIS_URL` | `rediss://default:token@xxx.upstash.io:6380` | Upstash TLS URL |
| `JWT_PRIVATE_KEY` | `-----BEGIN RSA PRIVATE KEY-----\n...` | RS256 private key, newlines as `\n` |
| `JWT_PUBLIC_KEY` | `-----BEGIN PUBLIC KEY-----\n...` | RS256 public key |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `REFRESH_TOKEN_EXPIRES_IN` | `7d` | Refresh token TTL |
| `S3_ENDPOINT` | `https://xxx.r2.cloudflarestorage.com` | Cloudflare R2 endpoint |
| `S3_BUCKET` | `pharmerp-prod` | |
| `S3_ACCESS_KEY` | `xxx` | R2 API token ID |
| `S3_SECRET_KEY` | `xxx` | R2 API token secret |
| `S3_REGION` | `auto` | R2 always uses `auto` |
| `CORS_ORIGIN` | `https://yourdomain.in` | Frontend URL |

### Frontend `.env.production`

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.yourdomain.in/api/v1` | Must be set at build time |

> Generate RS256 keys:
> ```bash
> openssl genrsa -out private.pem 2048
> openssl rsa -in private.pem -pubout -out public.pem
> # Collapse to single line for env vars:
> awk 'NF {sub(/\r/, ""); printf "%s\\n", $0;}' private.pem
> ```

---

## 7. Step-by-Step Deployment (Managed Cloud)

### Step 1 — Cloudflare: DNS + SSL

1. Add your domain to Cloudflare (free plan)
2. Set nameservers at your registrar to Cloudflare's
3. Add DNS records:
   ```
   Type  Name   Content              Proxy
   A     @      <Vercel IP / VPS IP> Proxied
   CNAME api    <Railway domain>     Proxied
   CNAME www    @                    Proxied
   ```
4. SSL/TLS → set to **Full (strict)**
5. Enable **Always Use HTTPS**

### Step 2 — Neon: PostgreSQL

1. Create a Neon project → select region **AWS ap-south-1 (Mumbai)**
2. Create database `pharmerp`
3. Copy the connection string (pooler version for production)
4. Enable connection pooling → **Transaction mode** (for stateless API)
5. Run migrations:
   ```bash
   # From your local machine with prod DATABASE_URL set:
   DATABASE_URL="<neon-connection-string>" pnpm db:migrate
   ```

### Step 3 — Upstash: Redis

1. Create an Upstash Redis database → region **ap-south-1**
2. Enable **Eviction: allkeys-lru** (important for BullMQ reliability — do NOT enable eviction if you need persistent queues; leave eviction off and set a maxmemory limit)
3. Copy the TLS connection URL (`rediss://...`)

### Step 4 — Cloudflare R2: Object Storage

1. Workers & Pages → R2 → Create bucket `pharmerp-prod`
2. Settings → Custom Domains → Add `files.yourdomain.in` (optional CDN subdomain)
3. Manage R2 API Tokens → Create token with:
   - Permissions: Object Read & Write
   - Bucket: pharmerp-prod
4. Note: `S3_ENDPOINT` = `https://<accountId>.r2.cloudflarestorage.com`

### Step 5 — Railway: Backend API

1. New project → Deploy from GitHub repo
2. Select the `/backend` service root (or use the Dockerfile approach)
3. Railway settings:
   - **Root directory**: leave blank (use repo root, Railway detects `backend/Dockerfile`)
   - Or set **Dockerfile path**: `backend/Dockerfile`
4. Add all backend environment variables from Section 6
5. Set **Region**: `ap-south-1` (Mumbai)
6. Under **Networking**: generate a public domain → this becomes `api.yourdomain.in`
7. Add a **Start command** override if not in Dockerfile:
   ```
   node dist/main
   ```
8. After first deploy, run migrations:
   ```bash
   railway run pnpm --filter backend drizzle-kit migrate
   ```
   Or set up a one-off migration service on Railway.

### Step 6 — Vercel: Frontend

1. Import the GitHub repo → Vercel
2. Framework preset: **Next.js**
3. Root directory: `frontend`
4. Build command: `cd .. && pnpm --filter frontend build` (or let Vercel detect)
5. Environment variables:
   ```
   NEXT_PUBLIC_API_URL = https://api.yourdomain.in/api/v1
   ```
6. Add custom domain: `yourdomain.in`
7. Vercel auto-provisions SSL via Cloudflare (make sure Cloudflare proxy is ON)

### Step 7 — Seed production database

```bash
# Run once after migrations
DATABASE_URL="<prod-connection-string>" pnpm db:seed
```

> The seed creates: 1 super admin (`admin@pharmerp.in` / `Admin@123!`), 2 branches, sample categories, 20 products, 2 suppliers.
> **Change the admin password immediately after first login.**

### Step 8 — Smoke test

```bash
# Health check
curl https://api.yourdomain.in/api/v1/health
# → { "status": "ok", "timestamp": "..." }

# Swagger UI
open https://api.yourdomain.in/api/docs

# Login
curl -X POST https://api.yourdomain.in/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pharmerp.in","password":"Admin@123!"}'
```

---

## 8. CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  PNPM_VERSION: 9

jobs:
  # ── Lint + Typecheck ────────────────────────────────────
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: "${{ env.PNPM_VERSION }}" }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint

  # ── Tests ────────────────────────────────────────────────
  test:
    runs-on: ubuntu-latest
    needs: check
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: "${{ env.PNPM_VERSION }}" }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  # ── Deploy Backend to Railway ────────────────────────────
  deploy-backend:
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Install Railway CLI
        run: npm install -g @railway/cli
      - name: Deploy
        run: railway up --service backend --detach
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

  # ── Deploy Frontend to Vercel ────────────────────────────
  deploy-frontend:
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: "${{ env.PNPM_VERSION }}" }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Deploy to Vercel
        run: |
          npx vercel --token=${{ secrets.VERCEL_TOKEN }} \
            --prod \
            --yes \
            --cwd frontend
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

  # ── Run DB Migrations (after backend deploy) ─────────────
  migrate:
    runs-on: ubuntu-latest
    needs: deploy-backend
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: "${{ env.PNPM_VERSION }}" }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Migrate database
        run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### GitHub Secrets required

Go to **Settings → Secrets → Actions** and add:

| Secret | Where to get |
|---|---|
| `RAILWAY_TOKEN` | Railway dashboard → Account → Tokens |
| `VERCEL_TOKEN` | Vercel → Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |
| `DATABASE_URL` | Neon dashboard → Connection string |

---

## 9. Database Migrations Strategy

**Rule: migrations run before the new code starts serving traffic.**

```
dev branch → PR → CI checks pass → merge to main
                                         │
                              GitHub Actions pipeline:
                              1. Build + test
                              2. Deploy backend image (Railway)
                              3. Run `drizzle-kit migrate` against prod DB
                              4. Railway auto-restarts with new image
                              5. Deploy frontend (Vercel)
```

**Manual migration (emergency)**:

```bash
# Set DATABASE_URL to prod in your shell (never commit this)
export DATABASE_URL="postgresql://..."
pnpm db:migrate
```

**Rollback a migration**:

Drizzle does not auto-rollback. Process:
1. Write a new migration that reverts the schema change
2. Deploy via the normal pipeline
3. Never run `drizzle-kit push` on production — always use `migrate`

---

## 10. VPS Option (Self-hosted, > 5 branches)

Use this if you need full control, lower cost at scale, or on-premise compliance.

**Recommended server**: Hetzner CX22 (2 vCPU, 4 GB RAM) in Falkenstein or Singapore → ~€4.5/month, or DigitalOcean Droplet 2 vCPU / 4 GB → $24/month.

### Setup on a fresh Ubuntu 22.04 VPS

```bash
# 1. Install Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. Install Certbot (Let's Encrypt)
sudo apt install -y certbot
sudo certbot certonly --standalone -d yourdomain.in -d api.yourdomain.in

# 3. Clone the repo
git clone https://github.com/yourorg/pharmerp.git /opt/pharmerp
cd /opt/pharmerp

# 4. Create .env.production (copy from template, fill in values)
cp .env.example .env.production
nano .env.production

# 5. Build and start all services
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 6. Run migrations
docker compose -f docker-compose.prod.yml exec backend \
  sh -c "cd /app && node -e \"require('./dist/database/drizzle.service')\""
# Or run migrations directly:
DATABASE_URL=<prod-url> pnpm db:migrate

# 7. Set up auto-renewal for SSL
echo "0 0 * * * root certbot renew --quiet && docker compose -f /opt/pharmerp/docker-compose.prod.yml restart nginx" \
  | sudo tee /etc/cron.d/certbot-renew
```

### GitHub Actions for VPS deploy

Replace the Railway job with:

```yaml
deploy-backend:
  runs-on: ubuntu-latest
  needs: test
  if: github.ref == 'refs/heads/main'
  steps:
    - uses: actions/checkout@v4
    - name: Deploy via SSH
      uses: appleboy/ssh-action@v1
      with:
        host: ${{ secrets.VPS_HOST }}
        username: ${{ secrets.VPS_USER }}
        key: ${{ secrets.VPS_SSH_KEY }}
        script: |
          cd /opt/pharmerp
          git pull origin main
          docker compose -f docker-compose.prod.yml --env-file .env.production \
            up -d --build --no-deps backend
```

---

## 11. Backup Strategy

### Database backups (Neon)

Neon provides **point-in-time restore (PITR)** on paid plans. For free tier, set up a daily dump:

```yaml
# Add to docker-compose.prod.yml or run as a cron job on VPS
db-backup:
  image: postgres:16-alpine
  environment:
    PGPASSWORD: ${POSTGRES_PASSWORD}
  volumes:
    - ./backups:/backups
  command: >
    sh -c "pg_dump -h ${DB_HOST} -U ${POSTGRES_USER} pharmerp
           | gzip > /backups/pharmerp_$(date +%Y%m%d_%H%M%S).sql.gz"
```

Upload to Cloudflare R2 or a separate bucket:

```bash
# Add to a cron job (daily at 2 AM)
0 2 * * * /opt/pharmerp/scripts/backup.sh
```

`scripts/backup.sh`:
```bash
#!/bin/bash
set -e
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/pharmerp_${TIMESTAMP}.sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
aws s3 cp "$BACKUP_FILE" "s3://pharmerp-backups/${TIMESTAMP}.sql.gz" \
  --endpoint-url "$S3_ENDPOINT"
rm "$BACKUP_FILE"
# Keep only last 30 days in R2
aws s3 ls "s3://pharmerp-backups/" --endpoint-url "$S3_ENDPOINT" \
  | awk '{print $4}' \
  | sort | head -n -30 \
  | xargs -I{} aws s3 rm "s3://pharmerp-backups/{}" --endpoint-url "$S3_ENDPOINT"
```

### Redis backups

Redis stores session tokens and BullMQ queues — **not business data**. If Redis restarts, users re-login and in-flight jobs re-queue. No special backup needed for Upstash (it persists by default).

---

## 12. Monitoring & Observability

### Uptime monitoring (Better Stack)

1. Create a free account at betterstack.com
2. Add monitors:
   - `https://api.yourdomain.in/api/v1/health` → alert if down > 1 min
   - `https://yourdomain.in` → alert if down > 1 min
3. Set alert channels: email + SMS

### Log management

For Railway: logs are built-in. Export to Better Stack Logs with one click.

For VPS, add to `docker-compose.prod.yml`:

```yaml
  # Sends logs to Better Stack / Logtail
  log-shipper:
    image: timberio/vector:latest-alpine
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./vector.toml:/etc/vector/vector.toml:ro
    restart: unless-stopped
```

### Error tracking (Sentry — optional)

Install in backend:
```bash
pnpm --filter backend add @sentry/nestjs @sentry/profiling-node
```

Add to `backend/src/main.ts` before `bootstrap()`:
```typescript
import * as Sentry from "@sentry/nestjs";
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

---

## 13. Security Hardening

- [ ] Change default admin password after first login
- [ ] Set `CORS_ORIGIN` to exact frontend URL (not `*`)
- [ ] Enable Cloudflare **Bot Fight Mode**
- [ ] Enable Cloudflare **WAF** managed rules (free plan includes basic rules)
- [ ] Set `x-content-type-options`, `x-frame-options`, `strict-transport-security` headers via Cloudflare Transform Rules
- [ ] Rotate JWT keys every 90 days (update `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` secrets)
- [ ] Never expose PostgreSQL or Redis ports publicly — only the API should connect to them
- [ ] For VPS: run `ufw allow 22,80,443/tcp && ufw enable` to block all other ports
- [ ] Enable Neon **IP Allow-list** to restrict DB access to Railway's egress IPs

---

## 14. Cost Estimate

### Managed cloud (recommended)

| Service | Tier | Cost/month |
|---|---|---|
| Vercel | Hobby (free) or Pro | $0–$20 |
| Railway | Starter | $5–$20 |
| Neon PostgreSQL | Free → Launch | $0–$19 |
| Upstash Redis | Pay-per-use | $0–$10 |
| Cloudflare R2 | First 10 GB free | $0–$5 |
| Cloudflare | Free | $0 |
| Better Stack | Free | $0 |
| **Total** | | **$5–$74/month** |

### VPS (self-hosted)

| Service | Tier | Cost/month |
|---|---|---|
| Hetzner CX22 VPS | 2 vCPU / 4 GB | €4.5 (~$5) |
| Cloudflare R2 | First 10 GB free | $0–$5 |
| Cloudflare | Free | $0 |
| Better Stack | Free | $0 |
| **Total** | | **~$5–$10/month** |

> VPS is significantly cheaper at scale but requires more maintenance (OS updates, Docker management, SSL renewal).

---

## 15. Rollback Procedure

### Railway (managed)

1. Railway dashboard → Deployments → click any previous deployment → **Redeploy**
2. If a migration ran and broke things, deploy the previous image first, then write a compensating migration

### VPS

```bash
# Roll back to previous git commit
cd /opt/pharmerp
git log --oneline -5            # find the commit to go back to
git checkout <commit-hash>
docker compose -f docker-compose.prod.yml up -d --build --no-deps backend
```

### Database

```bash
# Restore from backup
gunzip -c /backups/pharmerp_20240115_020000.sql.gz | psql "$DATABASE_URL"
```

---

## 16. Pre-launch Checklist

### Infrastructure
- [ ] Domain DNS pointing to Cloudflare
- [ ] Cloudflare SSL in Full (strict) mode
- [ ] Backend health check returns 200
- [ ] Swagger UI accessible at `/api/docs`
- [ ] Frontend loads and redirects to `/login`

### Database
- [ ] All migrations applied (`drizzle-kit migrate`)
- [ ] Seed data loaded (admin user + branches)
- [ ] Database connection pooling enabled on Neon

### Application
- [ ] Admin login works
- [ ] Create a product, add a batch, run a POS sale end-to-end
- [ ] Invoice PDF queues and generates
- [ ] Stock deducted after sale (verify in inventory)
- [ ] Schedule H product blocks without prescription

### Security
- [ ] Admin password changed from seed default
- [ ] CORS origin locked to frontend URL
- [ ] JWT keys are RS256 and stored only in secrets managers
- [ ] No `.env` files committed to git

### Operations
- [ ] Uptime monitor active and alerting
- [ ] Database backup cron running
- [ ] At least one successful manual restore test done

---

## 17. Environment-specific Branch Strategy

```
main        → production (auto-deploy on push)
staging     → staging environment (optional: separate Railway service)
feature/*   → Vercel preview deploys (automatic per PR)
```

Vercel automatically creates preview URLs for every pull request — share these with stakeholders for approval before merging.

---

## 18. AWS Deployment

### 18.1 Service Mapping

| Role | AWS Service | Why |
|---|---|---|
| Frontend | **AWS Amplify Hosting** | Native Next.js SSR support, auto-deploys from GitHub, global CDN |
| Backend API | **AWS App Runner** | Runs containers from ECR, auto-scales to zero, no cluster management |
| PostgreSQL | **Amazon RDS PostgreSQL 16** | Managed, Multi-AZ failover, automated backups, PITR |
| Redis | **Amazon ElastiCache for Redis** (Serverless) | Fully managed, scales automatically, no node management |
| Object storage | **Amazon S3** | Native S3 API — zero code change from MinIO |
| CDN | **Amazon CloudFront** | Sits in front of S3 and optionally the frontend |
| DNS + SSL | **Amazon Route 53 + ACM** | Native integration with App Runner and Amplify |
| Secrets | **AWS Secrets Manager** | Inject env vars at runtime, auto-rotation support |
| Container registry | **Amazon ECR** | Stores Docker images built in CI |
| Logs | **Amazon CloudWatch** | Centralised logs from App Runner + RDS |

**Recommended region: `ap-south-1` (Mumbai)**

### 18.2 Architecture

```
                    Route 53 (DNS)
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       ACM (SSL cert)         ACM (SSL cert)
              │                     │
   ┌──────────▼──────┐    ┌────────▼──────────┐
   │  AWS Amplify    │    │   App Runner       │
   │  (frontend)     │    │   (backend API)    │
   │  Next.js 15     │    │   NestJS/Fastify   │
   └─────────────────┘    └────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
   ┌──────────────────┐  ┌────────────────────┐  ┌────────────┐
   │  RDS PostgreSQL  │  │  ElastiCache Redis │  │   S3 + CF  │
   │  ap-south-1      │  │  Serverless        │  │  (files)   │
   │  Multi-AZ        │  │                    │  │            │
   └──────────────────┘  └────────────────────┘  └────────────┘
                                   │
                          Secrets Manager
                          (all env vars at runtime)
```

### 18.3 Step-by-Step Setup

#### Prerequisites
```bash
# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Configure with IAM user credentials
aws configure
# AWS Access Key ID: <your-key>
# AWS Secret Access Key: <your-secret>
# Default region: ap-south-1
# Default output format: json
```

#### Step 1 — ECR: Container Registry

```bash
# Create repositories for backend
aws ecr create-repository --repository-name pharmerp-backend --region ap-south-1

# Authenticate Docker to ECR
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS \
    --password-stdin <account-id>.dkr.ecr.ap-south-1.amazonaws.com

# Build and push backend image (first time, for testing)
docker build -f backend/Dockerfile -t pharmerp-backend .
docker tag pharmerp-backend:latest \
  <account-id>.dkr.ecr.ap-south-1.amazonaws.com/pharmerp-backend:latest
docker push <account-id>.dkr.ecr.ap-south-1.amazonaws.com/pharmerp-backend:latest
```

#### Step 2 — RDS: PostgreSQL

```bash
# Create a subnet group (use your default VPC subnets)
aws rds create-db-subnet-group \
  --db-subnet-group-name pharmerp-subnet-group \
  --db-subnet-group-description "PharmERP DB subnets" \
  --subnet-ids subnet-xxx subnet-yyy

# Create the RDS instance
aws rds create-db-instance \
  --db-instance-identifier pharmerp-prod \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16.3 \
  --master-username pharmerp \
  --master-user-password "<strong-password>" \
  --db-name pharmerp \
  --allocated-storage 20 \
  --storage-type gp3 \
  --storage-encrypted \
  --db-subnet-group-name pharmerp-subnet-group \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --region ap-south-1
```

> RDS takes ~10 minutes to provision. Check status:
> `aws rds describe-db-instances --db-instance-identifier pharmerp-prod`

#### Step 3 — ElastiCache: Redis Serverless

```bash
aws elasticache create-serverless-cache \
  --serverless-cache-name pharmerp-redis \
  --engine redis \
  --cache-usage-limits "DataStorage={Maximum=5,Unit=Gigabytes},ECPUPerSecond={Maximum=5000}" \
  --region ap-south-1
```

#### Step 4 — S3: Object Storage

```bash
aws s3api create-bucket \
  --bucket pharmerp-prod-files \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

# Block public access
aws s3api put-public-access-block \
  --bucket pharmerp-prod-files \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable server-side encryption
aws s3api put-bucket-encryption \
  --bucket pharmerp-prod-files \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

#### Step 5 — Secrets Manager: Store all env vars

```bash
aws secretsmanager create-secret \
  --name pharmerp/prod/backend \
  --region ap-south-1 \
  --secret-string '{
    "DATABASE_URL": "postgresql://pharmerp:<pass>@<rds-endpoint>:5432/pharmerp",
    "REDIS_URL": "rediss://<elasticache-endpoint>:6379",
    "JWT_PRIVATE_KEY": "-----BEGIN RSA PRIVATE KEY-----\\n...",
    "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...",
    "S3_ENDPOINT": "https://s3.ap-south-1.amazonaws.com",
    "S3_BUCKET": "pharmerp-prod-files",
    "S3_REGION": "ap-south-1",
    "CORS_ORIGIN": "https://yourdomain.in"
  }'
```

#### Step 6 — ACM: SSL Certificate

```bash
# Request a wildcard cert (must validate via DNS)
aws acm request-certificate \
  --domain-name "yourdomain.in" \
  --subject-alternative-names "*.yourdomain.in" \
  --validation-method DNS \
  --region ap-south-1

# Also request one in us-east-1 for CloudFront (CloudFront requires us-east-1 certs)
aws acm request-certificate \
  --domain-name "yourdomain.in" \
  --subject-alternative-names "*.yourdomain.in" \
  --validation-method DNS \
  --region us-east-1
```

Add the DNS CNAME validation records to Route 53 (shown in the ACM console).

#### Step 7 — App Runner: Backend

```bash
aws apprunner create-service \
  --service-name pharmerp-backend \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "<account-id>.dkr.ecr.ap-south-1.amazonaws.com/pharmerp-backend:latest",
      "ImageConfiguration": {
        "Port": "4000",
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URL": "arn:aws:secretsmanager:ap-south-1:<account-id>:secret:pharmerp/prod/backend:DATABASE_URL::",
          "REDIS_URL": "arn:aws:secretsmanager:ap-south-1:<account-id>:secret:pharmerp/prod/backend:REDIS_URL::"
        }
      },
      "ImageRepositoryType": "ECR"
    },
    "AutoDeploymentsEnabled": false
  }' \
  --instance-configuration '{"Cpu":"1 vCPU","Memory":"2 GB"}' \
  --health-check-configuration '{"Protocol":"HTTP","Path":"/api/v1/health","HealthyThreshold":1,"UnhealthyThreshold":5,"Interval":10}' \
  --region ap-south-1
```

#### Step 8 — Amplify: Frontend

1. Go to **AWS Amplify Console** → New App → Host Web App → GitHub
2. Select your repo + branch `main`
3. App settings:
   - **App root**: `frontend`
   - **Build command**: `cd .. && pnpm install --frozen-lockfile && pnpm --filter frontend build`
   - **Output directory**: `frontend/.next`
4. Environment variables:
   ```
   NEXT_PUBLIC_API_URL = https://api.yourdomain.in/api/v1
   ```
5. Add custom domain `yourdomain.in` → Amplify provisions ACM cert automatically

#### Step 9 — Route 53: DNS

```bash
# Create hosted zone for your domain
aws route53 create-hosted-zone \
  --name yourdomain.in \
  --caller-reference $(date +%s)

# Add CNAME for API subdomain pointing to App Runner URL
# (get App Runner URL from the console after deploy)
aws route53 change-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "api.yourdomain.in",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "<apprunner-url>.awsapprunner.com"}]
      }
    }]
  }'
```

### 18.4 Terraform (Infrastructure as Code)

Create `infra/aws/main.tf`:

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "pharmerp-tfstate"
    key    = "prod/terraform.tfstate"
    region = "ap-south-1"
  }
}

provider "aws" { region = "ap-south-1" }

# ── VPC ─────────────────────────────────────────────────────
data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── Security Groups ─────────────────────────────────────────
resource "aws_security_group" "rds" {
  name   = "pharmerp-rds-sg"
  vpc_id = data.aws_vpc.default.id
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
}

resource "aws_security_group" "redis" {
  name   = "pharmerp-redis-sg"
  vpc_id = data.aws_vpc.default.id
  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
}

# ── RDS ─────────────────────────────────────────────────────
resource "aws_db_instance" "postgres" {
  identifier             = "pharmerp-prod"
  engine                 = "postgres"
  engine_version         = "16.3"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = "pharmerp"
  username               = "pharmerp"
  password               = var.db_password
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  backup_retention_period = 7
  skip_final_snapshot    = false
  final_snapshot_identifier = "pharmerp-final-snapshot"
  tags = { Name = "pharmerp-prod" }
}

resource "aws_db_subnet_group" "main" {
  name       = "pharmerp-subnet-group"
  subnet_ids = data.aws_subnets.default.ids
}

# ── ElastiCache Serverless ───────────────────────────────────
resource "aws_elasticache_serverless_cache" "redis" {
  engine = "redis"
  name   = "pharmerp-redis"
  cache_usage_limits {
    data_storage { maximum = 5; unit = "GB" }
    ecpu_per_second { maximum = 5000 }
  }
  security_group_ids = [aws_security_group.redis.id]
}

# ── S3 Bucket ───────────────────────────────────────────────
resource "aws_s3_bucket" "files" {
  bucket = "pharmerp-prod-files"
  tags   = { Name = "pharmerp-files" }
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── ECR ─────────────────────────────────────────────────────
resource "aws_ecr_repository" "backend" {
  name                 = "pharmerp-backend"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

# ── Outputs ─────────────────────────────────────────────────
output "rds_endpoint"    { value = aws_db_instance.postgres.endpoint }
output "redis_endpoint"  { value = aws_elasticache_serverless_cache.redis.endpoint[0].address }
output "s3_bucket"       { value = aws_s3_bucket.files.bucket }
output "ecr_url"         { value = aws_ecr_repository.backend.repository_url }

variable "db_password" { sensitive = true }
```

```bash
# Deploy infrastructure
cd infra/aws
terraform init
terraform plan -var="db_password=<strong-password>"
terraform apply -var="db_password=<strong-password>"
```

### 18.5 GitHub Actions — AWS

```yaml
# .github/workflows/deploy-aws.yml
name: Deploy — AWS

on:
  push:
    branches: [main]

env:
  AWS_REGION: ap-south-1
  ECR_REPOSITORY: pharmerp-backend

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      image: ${{ steps.build.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push image
        id: build
        env:
          REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -f backend/Dockerfile -t $REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          echo "image=$REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT

  migrate:
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

  deploy-backend:
    runs-on: ubuntu-latest
    needs: [build-and-push, migrate]
    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Deploy to App Runner
        run: |
          aws apprunner start-deployment \
            --service-arn ${{ secrets.APP_RUNNER_SERVICE_ARN }}
```

### 18.6 AWS Cost Estimate (ap-south-1, 1–3 branches)

| Service | Tier | Cost/month |
|---|---|---|
| App Runner | 1 vCPU / 2 GB, ~8h/day active | ~$15–30 |
| RDS PostgreSQL | db.t4g.micro, 20 GB gp3 | ~$15 |
| ElastiCache Serverless | Light usage | ~$5–10 |
| S3 | 10 GB storage + requests | ~$1 |
| Amplify Hosting | Build minutes + bandwidth | ~$0–5 |
| Route 53 | Hosted zone + queries | ~$1 |
| CloudWatch Logs | Retention 30 days | ~$2 |
| ACM | Free | $0 |
| **Total** | | **~$39–64/month** |

---

## 19. Azure Deployment

### 19.1 Service Mapping

| Role | Azure Service | Why |
|---|---|---|
| Frontend | **Azure Static Web Apps** | Native Next.js support, GitHub Actions integration, global CDN, free tier |
| Backend API | **Azure Container Apps** | Serverless containers, KEDA-based autoscaling, pay per request |
| PostgreSQL | **Azure Database for PostgreSQL Flexible Server** | Fully managed, high-availability option, PITR |
| Redis | **Azure Cache for Redis** | Managed Redis, C0 Basic free for dev, C1 for prod |
| Object storage | **Azure Blob Storage** | S3-compatible via `@azure/storage-blob`, or use S3-compatible API layer |
| CDN | **Azure Front Door** (Standard) | Global CDN + WAF + SSL in one service |
| DNS + SSL | **Azure DNS + App Service Managed Certs** | Native cert provisioning |
| Secrets | **Azure Key Vault** | Store and inject secrets at runtime |
| Container registry | **Azure Container Registry (ACR)** | Stores Docker images |
| Logs | **Azure Monitor + Log Analytics** | Centralised logs, alerts, dashboards |

**Recommended region: `centralindia` (Pune) or `southindia` (Chennai)**

### 19.2 Architecture

```
                  Azure Front Door (CDN + WAF + SSL)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   ┌─────────────────────┐      ┌─────────────────────────┐
   │  Azure Static       │      │  Azure Container Apps   │
   │  Web Apps           │      │  (backend API)          │
   │  (Next.js 15)       │      │  NestJS/Fastify         │
   └─────────────────────┘      └─────────┬───────────────┘
                                           │
              ┌────────────────────────────┼────────────────────┐
              ▼                            ▼                     ▼
   ┌──────────────────────┐   ┌────────────────────┐  ┌───────────────────┐
   │  PostgreSQL Flexible │   │  Azure Cache for   │  │  Blob Storage     │
   │  Server (centralin.) │   │  Redis             │  │  + CDN endpoint   │
   └──────────────────────┘   └────────────────────┘  └───────────────────┘
                                           │
                                   Azure Key Vault
                                   (all secrets)
```

### 19.3 Step-by-Step Setup

#### Prerequisites
```bash
# Install Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Login
az login

# Set subscription
az account set --subscription "<subscription-id>"

# Create resource group
az group create \
  --name pharmerp-prod \
  --location centralindia
```

#### Step 1 — ACR: Container Registry

```bash
az acr create \
  --resource-group pharmerp-prod \
  --name pharmerpregistry \
  --sku Basic \
  --location centralindia \
  --admin-enabled true

# Get credentials
az acr credential show --name pharmerpregistry
```

#### Step 2 — PostgreSQL Flexible Server

```bash
az postgres flexible-server create \
  --resource-group pharmerp-prod \
  --name pharmerp-pg-prod \
  --location centralindia \
  --admin-user pharmerp \
  --admin-password "<strong-password>" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --database-name pharmerp \
  --public-access None \
  --backup-retention 7 \
  --geo-redundant-backup Disabled

# Get connection string
az postgres flexible-server show-connection-string \
  --server-name pharmerp-pg-prod \
  --database-name pharmerp \
  --admin-user pharmerp \
  --admin-password "<strong-password>"
```

#### Step 3 — Azure Cache for Redis

```bash
az redis create \
  --resource-group pharmerp-prod \
  --name pharmerp-redis-prod \
  --location centralindia \
  --sku Standard \
  --vm-size C1 \
  --enable-non-ssl-port false

# Get connection string
az redis show-access-keys \
  --resource-group pharmerp-prod \
  --name pharmerp-redis-prod
# Endpoint: pharmerp-redis-prod.redis.cache.windows.net:6380 (SSL)
```

#### Step 4 — Blob Storage

```bash
az storage account create \
  --resource-group pharmerp-prod \
  --name pharmerpfiles \
  --location centralindia \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access false \
  --https-only true \
  --min-tls-version TLS1_2

az storage container create \
  --account-name pharmerpfiles \
  --name pharmerp-prod \
  --public-access off
```

> The backend uses the AWS S3 SDK. To keep the same code, enable the **Azure Blob Storage S3-compatible API** or use Cloudflare R2 instead of Blob Storage. Both are options. Alternatively, swap `@aws-sdk/client-s3` for `@azure/storage-blob` in `s3.service.ts`.

#### Step 5 — Key Vault: Secrets

```bash
az keyvault create \
  --resource-group pharmerp-prod \
  --name pharmerp-kv-prod \
  --location centralindia \
  --sku standard

# Add secrets
az keyvault secret set --vault-name pharmerp-kv-prod \
  --name DATABASE-URL \
  --value "postgresql://pharmerp:<pass>@pharmerp-pg-prod.postgres.database.azure.com:5432/pharmerp?sslmode=require"

az keyvault secret set --vault-name pharmerp-kv-prod \
  --name REDIS-URL \
  --value "rediss://:accessKey@pharmerp-redis-prod.redis.cache.windows.net:6380"

az keyvault secret set --vault-name pharmerp-kv-prod \
  --name JWT-PRIVATE-KEY \
  --value "$(cat private.pem)"
```

#### Step 6 — Container Apps: Backend

```bash
# Create a Container Apps environment
az containerapp env create \
  --resource-group pharmerp-prod \
  --name pharmerp-env \
  --location centralindia

# Deploy the backend container
az containerapp create \
  --resource-group pharmerp-prod \
  --environment pharmerp-env \
  --name pharmerp-backend \
  --registry-server pharmerpregistry.azurecr.io \
  --image pharmerpregistry.azurecr.io/pharmerp-backend:latest \
  --registry-username pharmerpregistry \
  --registry-password "<acr-password>" \
  --target-port 4000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 10 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --secrets \
    "db-url=keyvaultref:https://pharmerp-kv-prod.vault.azure.net/secrets/DATABASE-URL,identityref:<managed-identity-id>" \
    "redis-url=keyvaultref:https://pharmerp-kv-prod.vault.azure.net/secrets/REDIS-URL,identityref:<managed-identity-id>" \
  --env-vars \
    "DATABASE_URL=secretref:db-url" \
    "REDIS_URL=secretref:redis-url" \
    "NODE_ENV=production" \
    "PORT=4000"
```

#### Step 7 — Static Web Apps: Frontend

```bash
az staticwebapp create \
  --resource-group pharmerp-prod \
  --name pharmerp-frontend \
  --location centralindia \
  --source "https://github.com/<yourorg>/pharmerp" \
  --branch main \
  --app-location "frontend" \
  --output-location ".next" \
  --login-with-github
```

Add environment variable in Azure Portal → Static Web Apps → pharmerp-frontend → Configuration:
```
NEXT_PUBLIC_API_URL = https://api.yourdomain.in/api/v1
```

#### Step 8 — Azure Front Door (CDN + SSL)

```bash
az afd profile create \
  --resource-group pharmerp-prod \
  --profile-name pharmerp-afd \
  --sku Standard_AzureFrontDoor

# Add endpoint for API
az afd endpoint create \
  --resource-group pharmerp-prod \
  --profile-name pharmerp-afd \
  --endpoint-name pharmerp-api

# Add custom domain + auto-SSL
az afd custom-domain create \
  --resource-group pharmerp-prod \
  --profile-name pharmerp-afd \
  --custom-domain-name api-yourdomain \
  --host-name api.yourdomain.in \
  --minimum-tls-version TLS12 \
  --certificate-type ManagedCertificate
```

### 19.4 Terraform (Azure)

Create `infra/azure/main.tf`:

```hcl
terraform {
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 3.0" }
  }
  backend "azurerm" {
    resource_group_name  = "pharmerp-tfstate"
    storage_account_name = "pharmerptfstate"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}

provider "azurerm" { features {} }

resource "azurerm_resource_group" "main" {
  name     = "pharmerp-prod"
  location = "Central India"
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "pharmerp-pg-prod"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "16"
  administrator_login    = "pharmerp"
  administrator_password = var.db_password
  storage_mb             = 32768
  sku_name               = "B_Standard_B1ms"
  backup_retention_days  = 7
}

resource "azurerm_postgresql_flexible_server_database" "pharmerp" {
  name      = "pharmerp"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "utf8"
  collation = "en_US.utf8"
}

resource "azurerm_redis_cache" "main" {
  name                = "pharmerp-redis-prod"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = 1
  family              = "C"
  sku_name            = "Standard"
  non_ssl_port_enabled = false
  minimum_tls_version = "1.2"
}

resource "azurerm_storage_account" "files" {
  name                     = "pharmerpfiles"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  https_traffic_only_enabled = true
  min_tls_version          = "TLS1_2"
}

resource "azurerm_container_registry" "acr" {
  name                = "pharmerpregistry"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true
}

resource "azurerm_key_vault" "main" {
  name                = "pharmerp-kv-prod"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "standard"
  tenant_id           = data.azurerm_client_config.current.tenant_id
}

data "azurerm_client_config" "current" {}

output "postgres_host" { value = azurerm_postgresql_flexible_server.main.fqdn }
output "redis_host"    { value = azurerm_redis_cache.main.hostname }
output "acr_server"    { value = azurerm_container_registry.acr.login_server }

variable "db_password" { sensitive = true }
```

### 19.5 GitHub Actions — Azure

```yaml
# .github/workflows/deploy-azure.yml
name: Deploy — Azure

on:
  push:
    branches: [main]

env:
  ACR_REGISTRY: pharmerpregistry.azurecr.io
  IMAGE_NAME: pharmerp-backend

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      image_tag: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v4

      - name: Log in to ACR
        uses: azure/docker-login@v1
        with:
          login-server: ${{ env.ACR_REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and push image
        run: |
          docker build -f backend/Dockerfile \
            -t ${{ env.ACR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} .
          docker push ${{ env.ACR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

  migrate:
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

  deploy-backend:
    runs-on: ubuntu-latest
    needs: [build-and-push, migrate]
    steps:
      - name: Azure login
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Container Apps
        uses: azure/container-apps-deploy-action@v1
        with:
          resourceGroup: pharmerp-prod
          containerAppName: pharmerp-backend
          registryUrl: ${{ env.ACR_REGISTRY }}
          imageToDeploy: ${{ env.ACR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
```

### 19.6 Azure Cost Estimate (Central India, 1–3 branches)

| Service | Tier | Cost/month |
|---|---|---|
| Container Apps | 1 vCPU / 2 GB, 8h/day active | ~$10–20 |
| PostgreSQL Flexible | B_Standard_B1ms | ~$15 |
| Azure Cache for Redis | C1 Standard | ~$55 |
| Blob Storage | 10 GB LRS | ~$1 |
| Static Web Apps | Free tier | $0 |
| Key Vault | Standard (10K ops) | ~$1 |
| Front Door | Standard | ~$35 |
| **Total** | | **~$117–127/month** |

> Azure Redis (C1 Standard) is notably expensive compared to Upstash. Use **Azure Cache for Redis Basic C0** ($16/month) for dev/low traffic, or keep Upstash as the Redis provider even when the rest runs on Azure — they're not coupled.

---

## 20. GCP Deployment

### 20.1 Service Mapping

| Role | GCP Service | Why |
|---|---|---|
| Frontend | **Firebase Hosting** | Global CDN, zero config, Next.js SSR via Cloud Run rewrite |
| Backend API | **Cloud Run** | Serverless containers, scales to zero, excellent cold-start, pay per request |
| PostgreSQL | **Cloud SQL for PostgreSQL 16** | Managed, automatic failover, PITR, IAM auth |
| Redis | **Memorystore for Redis** | Managed Redis in VPC, sub-millisecond latency |
| Object storage | **Google Cloud Storage** | S3-compatible via XML API — `S3_ENDPOINT` swap only |
| CDN | **Cloud CDN** (via Cloud Load Balancer) | Automatic HTTP/2, Anycast IPs, global PoPs |
| DNS + SSL | **Cloud DNS + Google-managed SSL** | Automatic cert provisioning via LB |
| Secrets | **Secret Manager** | Mount secrets as env vars on Cloud Run |
| Container registry | **Artifact Registry** | Replaces old GCR, supports Docker + Helm |
| Logs | **Cloud Logging + Cloud Monitoring** | Unified observability |

**Recommended region: `asia-south1` (Mumbai)**

### 20.2 Architecture

```
                Cloud DNS → Cloud Load Balancer → SSL
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                             ▼
   ┌────────────────────────┐           ┌─────────────────────────────┐
   │  Firebase Hosting      │           │   Cloud Run                 │
   │  (Next.js static)      │           │   (backend API)             │
   │  + Cloud Run SSR       │           │   NestJS/Fastify            │
   └────────────────────────┘           └───────────┬─────────────────┘
                                                     │ VPC Connector
              ┌──────────────────────────────────────┼───────────────────┐
              ▼                                       ▼                   ▼
   ┌──────────────────────┐      ┌────────────────────────┐  ┌──────────────────┐
   │  Cloud SQL           │      │  Memorystore Redis     │  │  Cloud Storage   │
   │  PostgreSQL 16       │      │  (private VPC)         │  │  (GCS bucket)    │
   │  asia-south1         │      │  asia-south1           │  │  + Cloud CDN     │
   └──────────────────────┘      └────────────────────────┘  └──────────────────┘
                                                     │
                                            Secret Manager
                                            (env vars at runtime)
```

### 20.3 Step-by-Step Setup

#### Prerequisites
```bash
# Install gcloud CLI
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init

# Create a new GCP project
gcloud projects create pharmerp-prod-001 --name="PharmERP Prod"
gcloud config set project pharmerp-prod-001

# Enable billing (required)
# → console.cloud.google.com → Billing → Link project

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  dns.googleapis.com
```

#### Step 1 — Artifact Registry: Container Images

```bash
gcloud artifacts repositories create pharmerp \
  --repository-format=docker \
  --location=asia-south1 \
  --description="PharmERP container images"

# Authenticate Docker
gcloud auth configure-docker asia-south1-docker.pkg.dev
```

#### Step 2 — Cloud SQL: PostgreSQL

```bash
gcloud sql instances create pharmerp-prod \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-south1 \
  --storage-type=SSD \
  --storage-size=20GB \
  --storage-auto-increase \
  --backup \
  --backup-start-time=02:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=7 \
  --no-assign-ip \
  --network=default

# Create database + user
gcloud sql databases create pharmerp --instance=pharmerp-prod
gcloud sql users create pharmerp \
  --instance=pharmerp-prod \
  --password="<strong-password>"

# Get private IP for VPC connections
gcloud sql instances describe pharmerp-prod --format="value(ipAddresses)"
```

#### Step 3 — VPC + Memorystore: Redis

```bash
# Create a Serverless VPC Access connector (Cloud Run needs this to reach Redis)
gcloud compute networks vpc-access connectors create pharmerp-connector \
  --region=asia-south1 \
  --subnet=default \
  --min-instances=2 \
  --max-instances=3

# Create Redis instance (must be in same region)
gcloud redis instances create pharmerp-redis \
  --size=1 \
  --region=asia-south1 \
  --redis-version=redis_7_0 \
  --network=default \
  --tier=STANDARD_HA

# Get Redis host IP
gcloud redis instances describe pharmerp-redis \
  --region=asia-south1 \
  --format="value(host)"
```

#### Step 4 — Cloud Storage: Object Storage

```bash
gcloud storage buckets create gs://pharmerp-prod-files \
  --location=asia-south1 \
  --uniform-bucket-level-access \
  --no-public-access-prevention

# Create HMAC key for S3-compatible access (AWS SDK works with GCS S3 API)
gcloud storage hmac keys create \
  --service-account=<service-account>@pharmerp-prod-001.iam.gserviceaccount.com
```

> GCS S3-compatible endpoint: `https://storage.googleapis.com`
> Set `S3_ENDPOINT=https://storage.googleapis.com` and `S3_REGION=asia-south1` in env vars — no code changes needed.

#### Step 5 — Secret Manager: Environment Variables

```bash
# Store each secret
echo -n "postgresql://pharmerp:<pass>@<cloud-sql-private-ip>/pharmerp" \
  | gcloud secrets create DATABASE_URL --data-file=-

echo -n "redis://<memorystore-ip>:6379" \
  | gcloud secrets create REDIS_URL --data-file=-

gcloud secrets create JWT_PRIVATE_KEY --data-file=private.pem
gcloud secrets create JWT_PUBLIC_KEY --data-file=public.pem

# Grant Cloud Run service account access
gcloud projects add-iam-policy-binding pharmerp-prod-001 \
  --member="serviceAccount:<cloud-run-sa>@pharmerp-prod-001.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

#### Step 6 — Cloud Run: Backend API

```bash
# Build and push image first
docker build -f backend/Dockerfile \
  -t asia-south1-docker.pkg.dev/pharmerp-prod-001/pharmerp/backend:latest .
docker push asia-south1-docker.pkg.dev/pharmerp-prod-001/pharmerp/backend:latest

# Deploy to Cloud Run
gcloud run deploy pharmerp-backend \
  --image=asia-south1-docker.pkg.dev/pharmerp-prod-001/pharmerp/backend:latest \
  --region=asia-south1 \
  --platform=managed \
  --port=4000 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=10 \
  --allow-unauthenticated \
  --vpc-connector=pharmerp-connector \
  --vpc-egress=private-ranges-only \
  --set-secrets=\
DATABASE_URL=DATABASE_URL:latest,\
REDIS_URL=REDIS_URL:latest,\
JWT_PRIVATE_KEY=JWT_PRIVATE_KEY:latest,\
JWT_PUBLIC_KEY=JWT_PUBLIC_KEY:latest \
  --set-env-vars=\
NODE_ENV=production,\
RUN_MIGRATIONS_ON_BOOT=true,\
PORT=4000,\
S3_ENDPOINT=https://storage.googleapis.com,\
S3_REGION=asia-south1,\
S3_BUCKET=pharmerp-prod-files
```

`RUN_MIGRATIONS_ON_BOOT=true` makes the container apply every pending Drizzle
migration before it starts serving. Cloud Run is the only place with network
access to the private Cloud SQL instance, so this is where migrations have to
run — no external CI runner can reach the database. `runMigrations()` takes a
Postgres advisory lock and skips migrations already recorded in
`__drizzle_migrations`, so a scale-up burst of cold starts cannot race or
double-apply. Set it to `false` only if you intend to apply migrations by hand.

Note that migrations run *before* `app.listen()`. Keep the startup probe
generous enough to cover the slowest migration in the backlog:

```bash
gcloud run services update pharmerp-backend \
  --region=asia-south1 \
  --update-env-vars=RUN_MIGRATIONS_ON_BOOT=true
```

#### Step 7 — Firebase Hosting: Frontend

```bash
# Install Firebase CLI
npm install -g firebase-tools
firebase login

# Initialize in the frontend directory
cd frontend
firebase init hosting

# firebase.json
cat > firebase.json << 'EOF'
{
  "hosting": {
    "public": "out",
    "rewrites": [{
      "source": "**",
      "run": {
        "serviceId": "pharmerp-frontend",
        "region": "asia-south1"
      }
    }]
  }
}
EOF

# Build and deploy frontend as a Cloud Run service too (for SSR)
gcloud run deploy pharmerp-frontend \
  --source frontend/ \
  --region=asia-south1 \
  --allow-unauthenticated \
  --set-env-vars="NEXT_PUBLIC_API_URL=https://api.yourdomain.in/api/v1"
```

#### Step 8 — Cloud DNS + Load Balancer + SSL

```bash
# Create managed DNS zone
gcloud dns managed-zones create pharmerp-zone \
  --dns-name=yourdomain.in. \
  --description="PharmERP DNS"

# Create a global load balancer with Google-managed SSL
gcloud compute addresses create pharmerp-ip --global

gcloud compute ssl-certificates create pharmerp-cert \
  --domains=yourdomain.in,api.yourdomain.in \
  --global

# Get the IP to update your registrar's nameservers
gcloud dns managed-zones describe pharmerp-zone --format="value(nameServers)"
```

### 20.4 Terraform (GCP)

Create `infra/gcp/main.tf`:

```hcl
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
  backend "gcs" {
    bucket = "pharmerp-tfstate"
    prefix = "prod"
  }
}

provider "google" {
  project = "pharmerp-prod-001"
  region  = "asia-south1"
}

# ── Cloud SQL ────────────────────────────────────────────────
resource "google_sql_database_instance" "postgres" {
  name             = "pharmerp-prod"
  database_version = "POSTGRES_16"
  region           = "asia-south1"
  deletion_protection = true

  settings {
    tier = "db-f1-micro"
    ip_configuration {
      ipv4_enabled    = false
      private_network = "projects/pharmerp-prod-001/global/networks/default"
    }
    backup_configuration {
      enabled            = true
      start_time         = "02:00"
      point_in_time_recovery_enabled = true
    }
  }
}

resource "google_sql_database" "pharmerp" {
  name     = "pharmerp"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "pharmerp" {
  name     = "pharmerp"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}

# ── Memorystore Redis ────────────────────────────────────────
resource "google_redis_instance" "main" {
  name           = "pharmerp-redis"
  tier           = "STANDARD_HA"
  memory_size_gb = 1
  region         = "asia-south1"
  redis_version  = "REDIS_7_0"
  authorized_network = "default"
}

# ── Cloud Storage ────────────────────────────────────────────
resource "google_storage_bucket" "files" {
  name          = "pharmerp-prod-files"
  location      = "ASIA-SOUTH1"
  force_destroy = false
  uniform_bucket_level_access = true
}

# ── Artifact Registry ────────────────────────────────────────
resource "google_artifact_registry_repository" "main" {
  location      = "asia-south1"
  repository_id = "pharmerp"
  format        = "DOCKER"
}

# ── Cloud Run ────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "backend" {
  name     = "pharmerp-backend"
  location = "asia-south1"

  template {
    containers {
      image = "asia-south1-docker.pkg.dev/pharmerp-prod-001/pharmerp/backend:latest"
      ports { container_port = 4000 }
      resources {
        limits = { cpu = "1", memory = "2Gi" }
      }
      dynamic "env" {
        for_each = {
          DATABASE_URL    = "DATABASE_URL"
          REDIS_URL       = "REDIS_URL"
          JWT_PRIVATE_KEY = "JWT_PRIVATE_KEY"
          JWT_PUBLIC_KEY  = "JWT_PUBLIC_KEY"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      env { name = "NODE_ENV"; value = "production" }
      env { name = "PORT";     value = "4000" }
    }
    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }
  }
}

resource "google_vpc_access_connector" "main" {
  name          = "pharmerp-connector"
  region        = "asia-south1"
  network       = "default"
  min_instances = 2
  max_instances = 3
  machine_type  = "f1-micro"
}

# ── Outputs ─────────────────────────────────────────────────
output "cloud_sql_ip"     { value = google_sql_database_instance.postgres.private_ip_address }
output "redis_host"       { value = google_redis_instance.main.host }
output "cloud_run_url"    { value = google_cloud_run_v2_service.backend.uri }

variable "db_password" { sensitive = true }
```

### 20.5 GitHub Actions — GCP

```yaml
# .github/workflows/deploy-gcp.yml
name: Deploy — GCP

on:
  push:
    branches: [main]

env:
  PROJECT_ID: pharmerp-prod-001
  REGION: asia-south1
  REGISTRY: asia-south1-docker.pkg.dev
  REPOSITORY: pharmerp
  SERVICE: pharmerp-backend

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # needed for Workload Identity Federation
    outputs:
      image: ${{ steps.build.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to GCP (Workload Identity — no long-lived keys)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGISTRY }}

      - name: Build and push image
        id: build
        env:
          IMAGE: ${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.SERVICE }}:${{ github.sha }}
        run: |
          docker build -f backend/Dockerfile -t $IMAGE .
          docker push $IMAGE
          echo "image=$IMAGE" >> $GITHUB_OUTPUT

  migrate:
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

  deploy:
    runs-on: ubuntu-latest
    needs: [build-and-push, migrate]
    permissions:
      id-token: write
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE }}
          image: ${{ needs.build-and-push.outputs.image }}
          region: ${{ env.REGION }}
```

> GCP Workload Identity Federation is recommended over long-lived service account keys. Set it up once:
> ```bash
> gcloud iam workload-identity-pools create github-pool --location=global
> gcloud iam workload-identity-pools providers create-oidc github-provider \
>   --location=global \
>   --workload-identity-pool=github-pool \
>   --issuer-uri=https://token.actions.githubusercontent.com \
>   --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"
> ```

### 20.6 GCP Cost Estimate (asia-south1, 1–3 branches)

| Service | Tier | Cost/month |
|---|---|---|
| Cloud Run (backend) | 1 vCPU / 2 GB, min 1 instance | ~$15–25 |
| Cloud SQL | db-f1-micro, 20 GB SSD | ~$10 |
| Memorystore Redis | 1 GB Standard HA | ~$50 |
| Cloud Storage | 10 GB + operations | ~$1 |
| Artifact Registry | 10 GB storage | ~$1 |
| Firebase Hosting | Free tier (10 GB/month) | $0 |
| Cloud DNS | Hosted zone + queries | ~$1 |
| Cloud Load Balancer | Forwarding rules + traffic | ~$20 |
| **Total** | | **~$98–108/month** |

> Memorystore Standard HA is expensive. Use **Basic tier** ($18/month, no replication) for low-traffic deployments, or substitute **Upstash Redis** (any cloud) to save ~$35/month.

---

## 21. Provider Comparison Summary

| Criteria | Managed (Railway/Vercel) | AWS | Azure | GCP |
|---|---|---|---|---|
| **Setup complexity** | Low | Medium | Medium-High | Medium |
| **India region** | Yes (Mumbai via Railway) | Yes (ap-south-1) | Yes (Central India) | Yes (asia-south1) |
| **Est. cost / month** | $25–80 | $39–64 | $117–127 | $98–108 |
| **Ops burden** | Very low | Medium | Medium | Low-Medium |
| **Scale ceiling** | Low-Medium | Very high | Very high | Very high |
| **Vendor lock-in** | Low | Medium | High | Medium |
| **Free tiers** | Yes (generous) | Limited | Limited | Yes (Cloud Run) |
| **Best for** | < 5 branches, quick start | Enterprise, AWS-familiar teams | Microsoft shops / Azure credits | GCP-familiar teams, serverless-first |
| **Terraform support** | No | Excellent | Excellent | Excellent |
| **GitHub Actions** | Native | `aws-actions/*` | `azure/*` | `google-github-actions/*` |

### Decision guide

```
Is this a quick MVP or < 3 branches?
  → Railway + Vercel (Section 7)

Do you have existing AWS infrastructure or an AWS-centric team?
  → AWS: App Runner + RDS + ElastiCache (Section 18)

Does your organisation already pay for Azure / have Azure credits?
  → Azure: Container Apps + PostgreSQL Flexible (Section 19)
  → Use Upstash Redis instead of Azure Cache to save ~$40/month

Do you want the simplest serverless containers with good free tier?
  → GCP: Cloud Run + Cloud SQL (Section 20)
  → Use Upstash Redis instead of Memorystore to save ~$35/month

Need on-premise or government cloud (NIC cloud / MeitY-approved)?
  → VPS option on approved data centre (Section 10), self-managed
```

### Cost optimisation tips (applies to all providers)

1. **Redis**: Always substitute managed cloud Redis with **Upstash** ($0–10/month) unless you need sub-millisecond VPC-private latency. BullMQ and sessions work fine over TLS Redis.
2. **Database**: Start with the smallest tier (db-f1-micro, db.t4g.micro, B1ms). Upgrade when `pg_stat_activity` shows connection pressure, not before.
3. **Containers**: Set `min-instances=0` on Cloud Run / Container Apps for non-POS workloads (background workers, report generation). POS-facing API needs `min=1` to avoid cold-start latency.
4. **Storage egress**: Use Cloudflare R2 as your S3 store regardless of which cloud runs the compute — R2 has zero egress fees. Wire `S3_ENDPOINT` to the R2 URL.
5. **Reservations**: After 3 months of stable traffic, buy 1-year reserved instances on RDS or Cloud SQL — typically 40–60% cheaper than on-demand.

---

*Last updated: 2026-05-21*
