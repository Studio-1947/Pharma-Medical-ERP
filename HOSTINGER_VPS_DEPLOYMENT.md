# Hostinger VPS Production Deployment & Maintenance Guide

Complete, step-by-step production deployment guide for running **Pharma-Medical ERP** on Hostinger VPS (Debian 13) with Docker Compose, DuckDNS dynamic domain redirection, Nginx reverse proxy, automated Let's Encrypt SSL certificates, scheduled daily database backups, and single-command disaster recovery restore scripts.

---

## 1. Server Environment Details

* **Hosting Provider**: Hostinger VPS (KVM 2)
* **Operating System**: Debian 13 (Trixie)
* **Public Static IPv4**: `187.127.185.82`
* **Default Admin User**: `root`
* **SSH Access Command**:
  ```bash
  ssh root@187.127.185.82
  ```

---

## 2. Step 1: Initial VPS System Preparation

1. **Connect to your Hostinger VPS via SSH**:
   ```bash
   ssh root@187.127.185.82
   ```

2. **Update system dependencies**:
   ```bash
   apt update && apt upgrade -y
   apt install -y curl git ufw tar gzip
   ```

3. **Install Docker Engine & Docker Compose V2**:
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   ```

4. **Verify Docker Installation**:
   ```bash
   docker --version
   docker compose version
   ```

5. **Configure Basic Firewall (UFW)**:
   ```bash
   ufw allow 22/tcp    # SSH
   ufw allow 80/tcp    # HTTP
   ufw allow 443/tcp   # HTTPS
   ufw --force enable
   ```

---

## 3. Step 2: DuckDNS Domain Details

* **DuckDNS Subdomain**: `rdm-erp`
* **Full Public Domain**: `rdm-erp.duckdns.org`
* **Account Email**: `localdesigncommunity@gmail.com`
* **DuckDNS Token**: `f31057c7-fa09-4b76-a8af-e1d30b9c982a`
* **Target IPv4**: `187.127.185.82`

---

## 4. Step 3: Clone Codebase & Configure Environment

1. **Clone your private GitHub repository on the VPS**:
   ```bash
   cd /opt
   git clone git@github.com:Studio-1947/Pharma-Medical-ERP.git pharmerp
   cd pharmerp
   ```

2. **Make all maintenance scripts executable**:
   ```bash
   chmod +x scripts/*.sh
   ```

3. **Create the production environment file (`.env.production`)**:
   ```bash
   nano .env.production
   ```

4. **Paste and configure the following template**:
   ```env
   NODE_ENV=production

   # Domain & SSL Settings
   DUCKDNS_DOMAIN=rdm-erp
   DUCKDNS_TOKEN=f31057c7-fa09-4b76-a8af-e1d30b9c982a
   SSL_EMAIL=localdesigncommunity@gmail.com

   # PostgreSQL Database Configuration
   DB_HOST=postgres
   DB_PORT=5432
   DB_NAME=pharmerp
   DB_USER=pharmerp
   DB_PASSWORD=GenerateStrongDBPasswordHere123!
   DATABASE_URL=postgresql://pharmerp:GenerateStrongDBPasswordHere123!@postgres:5432/pharmerp

   # Redis Configuration
   REDIS_HOST=redis
   REDIS_PORT=6379
   REDIS_PASSWORD=GenerateStrongRedisPassword123!

   # JWT & Security Secrets
   JWT_SECRET=GenerateSuperSecretJWTKeyAtLeast32CharsLong!
   JWT_EXPIRES_IN=7d
   CORS_ORIGINS=https://rdm-erp.duckdns.org,http://187.127.185.82

   # MinIO Object Storage
   MINIO_ENDPOINT=minio
   MINIO_PORT=9000
   MINIO_ACCESS_KEY=pharmerp_minio_access
   MINIO_SECRET_KEY=GenerateStrongMinioSecretKey123!
   MINIO_BUCKET_NAME=pharmerp-uploads

   # GCP Cloud SQL Sync (Optional for daily GCP data preservation)
   # GCP_DATABASE_URL=postgresql://user:pass@gcp-cloudsql-ip:5432/pharmerp
   # AUTO_RESTORE_GCP_TO_HOSTINGER=true
   ```


---

## 5. Step 4: DuckDNS Dynamic IP Auto-Updater Setup

To ensure your DuckDNS domain always points to `187.127.185.82`:

1. Test the DuckDNS updater script manually:
   ```bash
   ./scripts/update-duckdns.sh
   ```
   *(Expected output: `DuckDNS update successful! Response: OK`)*

2. Add a system cron job to run it automatically every 5 minutes:
   ```bash
   crontab -e
   ```
   Add this line at the bottom:
   ```cron
   */5 * * * * /opt/pharmerp/scripts/update-duckdns.sh >> /var/log/duckdns.log 2>&1
   ```

---

## 6. Step 5: Launch Production Containers

1. **Build and start all services using Docker Compose**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

2. **Check service status & health checks**:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```
   *(All services: `pharmerp_nginx`, `pharmerp_backend`, `pharmerp_frontend`, `pharmerp_postgres_prod`, `pharmerp_postgres_backup`, `pharmerp_redis_prod` should display status `Up` or `healthy`)*.

3. **Verify web application access**:
   Open `http://187.127.185.82` or `http://your-subdomain.duckdns.org` in your browser.

### Deployment and 502 recovery runbook

The normal GitHub Action invokes `scripts/deploy.sh`. It waits for the API,
frontend, and the actual nginx HTTPS route before reporting success. It also
keeps one rollback image for the backend and frontend, and restores it
automatically when a new release fails its health checks.

This stack is safe for a shared VPS: the host nginx remains the sole public
listener on ports **80** and **443**, and proxies directly to this project's
private loopback ports. The ERP site must use `127.0.0.1:4001` for `/api/` and
`127.0.0.1:3001` for `/`; do not stop or alter nginx sites belonging to other
projects. The Docker nginx service is an optional direct-edge profile and is
not used by `scripts/deploy.sh` on the shared VPS.

If nginx ever displays **502 Bad Gateway**, connect to the VPS and run the
following commands exactly. They do not delete the database or Docker volumes.

```bash
cd /opt/pharmerp

# Show which service is unhealthy and the reason it failed to start.
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 nginx frontend backend

# Check each layer independently: API, Next.js frontend, then nginx proxy.
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend node -e "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T frontend node -e "fetch('http://127.0.0.1:3000').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
curl -fsS http://127.0.0.1:4001/health
curl -fsSI http://127.0.0.1:3001/
```

To restore the last known-good application images immediately (while you
investigate the failed release), run:

```bash
cd /opt/pharmerp
docker image inspect pharmerp-backend:rollback pharmerp-frontend:rollback
docker image tag pharmerp-backend:rollback pharmerp-backend:current
docker image tag pharmerp-frontend:rollback pharmerp-frontend:current
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build --force-recreate --wait --wait-timeout 180 backend frontend
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Do not use `docker compose down -v`, `docker volume prune`, or `docker system
prune --volumes` for a 502 incident: those can remove production data.

---

## 7. Step 6: SSL Certificate Setup (Let's Encrypt / HTTPS)

1. **Bootstrap SSL Certificate**:
   ```bash
   ./scripts/init-ssl.sh
   ```

2. **Set up Automated Monthly SSL Renewal**:
   ```bash
   crontab -e
   ```
   Add this cron rule:
   ```cron
   0 0 1 * * docker run --rm -v /opt/pharmerp/certbot/conf:/etc/letsencrypt -v /opt/pharmerp/certbot/www:/var/www/certbot certbot/certbot renew && docker compose -f /opt/pharmerp/docker-compose.prod.yml exec nginx nginx -s reload
   ```

---

## 8. Step 7: Database Backup Strategy & Single-Command Fallback / Disaster Recovery

### A. Automated Daily Backups
* The `pharmerp_postgres_backup` container automatically creates gzip compressed PostgreSQL dumps daily at **02:00 AM**.
* Backups are safely persisted on your host VPS under `/opt/pharmerp/backups/postgres/`.
* Retention policy automatically keeps:
  * **14 daily backups**
  * **4 weekly backups**
  * **6 monthly backups**

### B. Manual Backup (Before Upgrades / Code Pushes)
To manually capture an immediate database snapshot before making software updates:
```bash
./scripts/backup-db.sh
```
*(Creates snapshot: `backups/postgres/pharmerp_manual_YYYYMMDD_HHMMSS.sql.gz`)*

### C. Single-Command Database Fallback / Restoration
If a system failure, bad migration, or data corruption occurs, you can restore your database snapshot with a single command:

1. **Interactive Snapshot Selection**:
   ```bash
   ./scripts/restore-db.sh
   ```
   *(Presents an interactive menu listing all available snapshots and prompts for confirmation before safely resetting and restoring the database)*.

2. **Direct Snapshot Restoration**:
   ```bash
   ./scripts/restore-db.sh ./backups/postgres/pharmerp_manual_20260810_120000.sql.gz
   ```

---

## 9. Step 8: Automated GitHub Actions CI/CD for Private Repository

Whenever you push new code to the `main` branch, GitHub Actions will automatically run linting & unit tests, connect to your Hostinger VPS over SSH, pull the latest code, create a safety database backup, and rebuild the production Docker containers seamlessly.

### A. Set Up GitHub Deploy Key on VPS (Required for Private Repo)
Since your repository is private, the VPS needs permission to `git pull` from GitHub without prompting for passwords:

1. **On your Hostinger VPS (`root@187.127.185.82`), generate an SSH key**:
   ```bash
   ssh-keygen -t ed25519 -C "deploy-key-pharmerp" -N "" -f ~/.ssh/id_ed25519
   ```

2. **Display and copy your public SSH key**:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```

3. **Add Deploy Key to GitHub**:
   * Open your private GitHub repository in browser.
   * Go to **Settings** -> **Deploy keys** -> Click **Add deploy key**.
   * Title: `Hostinger VPS Deploy Key`
   * Key: Paste the content of `id_ed25519.pub`.
   * Click **Add key**.

4. **Verify GitHub Git SSH Connection on VPS**:
   ```bash
   ssh -T git@github.com
   ```
   *(Expected output: `Hi username/repository! You've successfully authenticated...`)*

---

### B. Configure GitHub Repository Secrets for Actions

To enable GitHub Actions to SSH into your Hostinger VPS (`187.127.185.82`):

1. **Display your private SSH key on the VPS**:
   ```bash
   cat ~/.ssh/id_ed25519
   ```

2. **Add Secrets to GitHub Repository**:
   * Go to your GitHub repository -> **Settings** -> **Secrets and variables** -> **Actions**.
   * Click **New repository secret** and add the following 3 secrets:

| Secret Name | Value |
| :--- | :--- |
| `VPS_HOST` | `187.127.185.82` |
| `VPS_USERNAME` | `root` |
| `VPS_SSH_KEY` | Paste the full private key output from `cat ~/.ssh/id_ed25519` (including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`) |

---

### C. Workflow Behavior (`.github/workflows/deploy-vps.yml`)

Upon pushing code to `main`:
1. **Lint & Test**: GitHub Actions runs `pnpm install`, shared package builds, TypeScript checks, and unit tests.
2. **SSH Connection**: Connects to `187.127.185.82`.
3. **Pull & Backup**: Navigates to `/opt/pharmerp`, executes `git pull origin main`, and runs `./scripts/backup-db.sh` to ensure data safety.
4. **Build & Refresh**: Executes `docker compose -f docker-compose.prod.yml up -d --build` to deploy updated code.
5. **Health Check**: Verifies `/health` responds with HTTP 200.

---

## 10. Step 9: Zero Data-Loss & Automated Daily GCP Backup Preservation

To ensure **100% data preservation** while your GCP account is active (even if your GCP account/subscription expires unexpectedly), we have added an automated daily GCP sync service:

### A. How the Automated Daily GCP Preserver Works:
The script [`scripts/sync-gcp-daily.sh`](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/scripts/sync-gcp-daily.sh) runs automatically every day at **01:00 AM** on your Hostinger VPS:
1. Connects to your GCP Cloud SQL instance.
2. Dumps and compresses a complete database snapshot into `/opt/pharmerp/backups/gcp_daily/gcp_preserve_YYYYMMDD_HHMMSS.sql.gz`.
3. Retains 30 days of daily GCP backups on your Hostinger VPS disk.
4. *(Optional)* If `AUTO_RESTORE_GCP_TO_HOSTINGER=true` is set in `.env.production`, it will automatically sync the GCP data directly into your Hostinger PostgreSQL database every night!

---

### B. Setting Up the Daily GCP Sync Cron Job on Hostinger VPS:

1. **Add your GCP Database Connection String to `.env.production` on Hostinger VPS**:
   ```env
   GCP_DATABASE_URL=postgresql://DB_USER:DB_PASSWORD@GCP_CLOUD_SQL_IP:5432/pharmerp
   AUTO_RESTORE_GCP_TO_HOSTINGER=true
   ```

2. **Test the daily sync script manually**:
   ```bash
   cd /opt/pharmerp
   ./scripts/sync-gcp-daily.sh
   ```

3. **Add the Daily Cron Job on Hostinger VPS**:
   ```bash
   crontab -e
   ```
   Add this cron rule:
   ```cron
   0 1 * * * /opt/pharmerp/scripts/sync-gcp-daily.sh >> /var/log/gcp_daily_sync.log 2>&1
   ```

---

### C. Manual One-Time GCP Export & Restore Workflow
If you want to migrate GCP data immediately right now:
```bash
# 1. Export from GCP
./scripts/export-gcp-db.sh "postgresql://USER:PASSWORD@GCP_CLOUD_SQL_IP:5432/pharmerp"

# 2. Copy to VPS
scp backups/postgres/gcp_cloudsql_export_*.sql.gz root@187.127.185.82:/opt/pharmerp/backups/postgres/

# 3. Restore on Hostinger VPS
ssh root@187.127.185.82
cd /opt/pharmerp
./scripts/restore-db.sh
```

---

## 11. Useful Operational Commands

* **View live Backend API logs**:
  ```bash
  docker compose -f docker-compose.prod.yml logs -f --tail=100 backend
  ```

* **View live Frontend logs**:
  ```bash
  docker compose -f docker-compose.prod.yml logs -f --tail=100 frontend
  ```

* **View Database Backup logs**:
  ```bash
  docker compose -f docker-compose.prod.yml logs -f postgres_backup
  ```

* **View Daily GCP Sync logs**:
  ```bash
  cat /var/log/gcp_daily_sync.log
  ```

* **Restart Application Stack**:
  ```bash
  docker compose -f docker-compose.prod.yml restart
  ```

* **Stop Application Stack**:
  ```bash
  docker compose -f docker-compose.prod.yml down
  ```




---

## 12. PWA Updates & Static Asset Retention (portable across VPS and GCP)

The installed PWA used to break on every deploy, showing a blank screen or
"not connected" until it was manually refreshed or reinstalled. Two independent
mechanisms fix that. Both are automatic and neither is specific to this VPS.

### A. Service worker versioning

`frontend/public/sw.js` is generated at build time from
`frontend/scripts/sw.template.js` and stamped with a unique `SW_VERSION`
(`frontend/scripts/generate-sw.mjs`, wired into the frontend `build` script).

* HTML is fetched network-first, so a deploy is picked up on the next navigation.
* Every cache name carries the build stamp and the worker deletes all
  non-current caches on activate, so stale HTML cannot survive a deploy.
* Open clients check for a new build every 60s and show an "Update" prompt. A
  backgrounded tab applies it automatically after 60s. The POS screen suppresses
  that automatic reload while a cart is open.

Set `SW_VERSION` or `GIT_SHA` in the build environment to pin the stamp to a
commit instead of a timestamp.

### B. Static asset retention

Each deploy builds a fresh image, so the previous build's `/_next/static/*`
files would otherwise vanish when the new container starts. A browser still
running the old build then requests a chunk that no longer exists and dies with
`ChunkLoadError`. Note this failure mode has nothing to do with service workers;
it breaks a plain browser tab too.

Chunk filenames are content-hashed, so builds can coexist. Given any directory
that outlives the container, `frontend/docker-entrypoint.sh` on each start:

1. **publishes** this build's assets into the archive (adds, never deletes),
2. **restores** older builds' assets into `.next/static` so this container can
   serve them, without ever overwriting what this build ships,
3. **prunes** assets that no deploy has shipped for `NEXT_STATIC_RETENTION_DAYS`.

Step 2 is what makes this host-agnostic: the Next.js server itself serves the
retained assets, so nothing depends on a particular proxy or volume driver.

**Safety.** This is a resilience feature and must never be why the app is down:

* Inactive unless the archive directory exists, so an unconfigured host is a
  strict no-op. Set `NEXT_STATIC_ARCHIVE=` to disable it outright.
* A read-only archive still serves restores; only publish and prune are skipped.
* Every step is best-effort; the server is exec'd unconditionally.
* `NEXT_STATIC_MAX_FILES` (default 20000) refuses to restore a runaway archive
  rather than slowing every start.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_STATIC_ARCHIVE` | `/var/www/next-static-root` | Archive path; empty disables |
| `NEXT_STATIC_RETENTION_DAYS` | `30` | How long an unused asset is kept |
| `NEXT_STATIC_MAX_FILES` | `20000` | Refuse to restore beyond this size |

### C. VPS setup (already wired)

`docker-compose.prod.yml` mounts the `next_static_archive` volume read-write on
`frontend` and read-only on `nginx`. `nginx.conf` additionally serves
`/_next/static/` straight from that volume with immutable caching as a fast
path, falling back to the frontend container on any miss. That fast path is an
optimisation only; correctness does not depend on it.

`scripts/deploy.sh` needs no changes. The volume is created on the first
`docker compose up -d --build`.

* Inspect the archive:
  ```bash
  docker compose -f docker-compose.prod.yml exec frontend \
    find /var/www/next-static-root/_next/static -type f | wc -l
  ```

* Reset it. Safe: it rebuilds on the next start, and the only cost is that
  already-open older clients must reload before resolving chunks again:
  ```bash
  docker compose -f docker-compose.prod.yml down
  docker volume rm pharma-medical-erp_next_static_archive
  docker compose -f docker-compose.prod.yml up -d
  ```

* Note `docker compose down -v` removes this volume **and the database
  volumes**. Prefer the targeted `docker volume rm` above.

### D. GCP / Cloud Run setup

Cloud Run has no nginx and no Docker volumes, so only part B applies, which is
exactly why the restore step exists. Mount a Cloud Storage bucket at the archive
path and the identical mechanism works.

Volume mounts require the second generation execution environment, which
Cloud Run selects automatically unless told otherwise.

```bash
gcloud run deploy pharmerp-frontend \
  --image REGION-docker.pkg.dev/PROJECT/REPO/frontend:TAG \
  --add-volume mount-path=/var/www/next-static-root,type=cloud-storage,bucket=BUCKET_NAME,readonly=false \
  --set-env-vars NEXT_STATIC_RETENTION_DAYS=7
```

Cloud Run specifics worth knowing:

* **Use a shorter retention.** Every cold start walks the archive, so keeping it
  small matters more here than on the VPS. Seven days is a reasonable start.
* **Concurrent starts are safe.** Publish only writes files that are missing,
  and content-hashed names mean an existing file already holds the right bytes.
* **A read-only bucket still works** (`readonly=true`) if you would rather
  populate it from CI than from the running service.
* **The alternative** is the GCP-native route: point `assetPrefix` at a bucket
  or CDN and upload each build's static output there from CI, never deleting.
  That avoids the FUSE walk entirely and is worth it at high traffic, at the
  cost of a CI step and CORS configuration.

If the frontend is deployed to **Vercel** instead, nothing is needed. Vercel
keeps previous deployments' assets served indefinitely.
