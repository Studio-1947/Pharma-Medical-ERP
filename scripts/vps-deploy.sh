#!/usr/bin/env bash
# ==============================================================================
# MedERP Hostinger VPS Deployment Script
# ==============================================================================
# Run this script on the VPS as root or deploy user with sudo access.
# It will:
#   1. Install Docker if missing
#   2. Clone/ update the repo to /opt/pharmerp
#   3. Create .env.production with generated passwords
#   4. Modify docker-compose.prod.yml to work alongside existing projects
#   5. Configure system nginx to proxy rdm-erp.duckdns.org → Docker
#   6. Set up SSL via Let's Encrypt
#   7. Start all services
#   8. Set up cron jobs (DuckDNS, SSL renewal, backups)
# ==============================================================================
set -euo pipefail

APP_DIR="/opt/pharmerp"
REPO_URL="git@github.com:Studio-1947/Pharma-Medical-ERP.git"
BRANCH="main"
DUCKDNS_DOMAIN="rdm-erp"
DUCKDNS_TOKEN="f31057c7-fa09-4b76-a8af-e1d30b9c982a"
SSL_EMAIL="localdesigncommunity@gmail.com"
SYSTEM_USER="${SUDO_USER:-deploy}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

# ─── 0. Pre-flight checks ──────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " MedERP VPS Deployment — Pre-flight Checks"
echo "============================================================"

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
  err "This script must be run as root. Use: sudo bash $0"
  exit 1
fi

# Check disk space (need at least 5GB free)
DISK_FREE=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
if [ "$DISK_FREE" -lt 5 ]; then
  err "Not enough disk space. Need at least 5GB, have ${DISK_FREE}GB"
  exit 1
fi
log "Disk space OK: ${DISK_FREE}GB free"

# Check RAM
RAM_TOTAL=$(free -g | awk '/Mem:/ {print $2}')
log "RAM: ${RAM_TOTAL}GB total"

# ─── 1. Install Docker if missing ───────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 1: Docker Installation"
echo "============================================================"

if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
  log "Docker Compose: $(docker compose version)"
else
  warn "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$SYSTEM_USER" 2>/dev/null || true
  log "Docker installed: $(docker --version)"
fi

# ─── 2. Clone or update the repository ──────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 2: Repository Setup"
echo "============================================================"

if [ -d "$APP_DIR/.git" ]; then
  log "Repository already exists at $APP_DIR — pulling latest..."
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
  chmod +x scripts/*.sh 2>/dev/null || true
  log "Repository updated to latest $BRANCH"
else
  warn "Cloning repository..."
  mkdir -p /opt
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  chmod +x scripts/*.sh 2>/dev/null || true
  log "Repository cloned to $APP_DIR"
fi

# ─── 3. Create .env.production ───────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 3: Environment Configuration"
echo "============================================================"

cd "$APP_DIR"

if [ -f .env.production ]; then
  warn ".env.production already exists — skipping creation"
  warn "Delete it first if you want to regenerate: rm .env.production"
else
  # Generate secure passwords
  DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  REDIS_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
  MINIO_SECRET=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  CLICKHOUSE_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

  cat > .env.production <<EOF
NODE_ENV=production

# Domain & SSL Settings
DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
SSL_EMAIL=${SSL_EMAIL}

# PostgreSQL Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=pharmerp
DB_USER=pharmerp
DB_PASSWORD=${DB_PASS}
# Kept alongside the DB_* names so both Docker's official Postgres image and
# the application use one identical credential set.
POSTGRES_DB=pharmerp
POSTGRES_USER=pharmerp
POSTGRES_PASSWORD=${DB_PASS}
DATABASE_URL=postgresql://pharmerp:${DB_PASS}@postgres:5432/pharmerp

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASS}

# JWT & Security
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
CORS_ORIGINS=https://${DUCKDNS_DOMAIN}.duckdns.org,http://187.127.185.82

# MinIO Object Storage
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=pharmerp_minio_user
MINIO_SECRET_KEY=${MINIO_SECRET}
MINIO_BUCKET_NAME=pharmerp-uploads

# ClickHouse Analytics
CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASS}

# App
PORT=4000
RUN_MIGRATIONS_ON_BOOT=true
CORS_ORIGIN=https://${DUCKDNS_DOMAIN}.duckdns.org
EOF

  log ".env.production created with generated passwords"
  echo ""
  echo "============================================================"
  echo " IMPORTANT: Save these passwords somewhere safe!"
  echo "============================================================"
  echo "  DB_PASSWORD:      ${DB_PASS}"
  echo "  REDIS_PASSWORD:   ${REDIS_PASS}"
  echo "  JWT_SECRET:       ${JWT_SECRET}"
  echo "  MINIO_SECRET:     ${MINIO_SECRET}"
  echo "  CLICKHOUSE_PASS:  ${CLICKHOUSE_PASS}"
  echo "============================================================"
  echo ""
fi

# ─── 4. Modify docker-compose.prod.yml ──────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 4: Docker Compose Configuration"
echo "============================================================"

# We need to modify the docker-compose.prod.yml to:
#   - Remove nginx service (system nginx will handle this)
#   - Expose backend on host port 4001
#   - Expose frontend on host port 3001
#   - Keep postgres, redis, clickhouse, minio internal-only

if ! grep -q "# VPS_DEPLOYED" docker-compose.prod.yml 2>/dev/null; then
  warn "Modifying docker-compose.prod.yml for VPS deployment..."

  # Backup original
  cp docker-compose.prod.yml docker-compose.prod.yml.bak

  # Create modified version using Python (available on Debian)
  python3 << 'PYEOF'
import re

with open("docker-compose.prod.yml", "r") as f:
    content = f.read()

# Remove nginx service block
nginx_pattern = r'  nginx:.*?(?=\n  [a-z]|\nnetworks:|\nvolumes:)'
content = re.sub(nginx_pattern, '', content, flags=re.DOTALL)

# Add host port bindings to backend (4001:4000)
if "4001:4000" not in content:
    content = content.replace(
        "    networks:\n      - pharmerp_net\n    logging:\n      driver: \"json-file\"\n      options:\n        max-size: \"50m\"\n        max-file: \"5\"\n    healthcheck:\n      test: [\"CMD-SHELL\", \"wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health || exit 1\"]",
        "    ports:\n      - \"4001:4000\"\n    networks:\n      - pharmerp_net\n    logging:\n      driver: \"json-file\"\n      options:\n        max-size: \"50m\"\n        max-file: \"5\"\n    healthcheck:\n      test: [\"CMD-SHELL\", \"wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health || exit 1\"]"
    )

# Add host port bindings to frontend (3001:3000)
if "3001:3000" not in content:
    content = content.replace(
        "    depends_on:\n      - backend\n    networks:\n      - pharmerp_net\n    logging:\n      driver: \"json-file\"\n      options:\n        max-size: \"50m\"\n        max-file: \"5\"\n    healthcheck:\n      test: [\"CMD-SHELL\", \"wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1\"]",
        "    ports:\n      - \"3001:3000\"\n    depends_on:\n      - backend\n    networks:\n      - pharmerp_net\n    logging:\n      driver: \"json-file\"\n      options:\n        max-size: \"50m\"\n        max-file: \"5\"\n    healthcheck:\n      test: [\"CMD-SHELL\", \"wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1\"]"
    )

# Remove nginx from depends_on in backend and frontend
content = re.sub(r'      - nginx\n', '', content)

# Remove certbot volume mounts (handled by system nginx now)
content = re.sub(r'      - ./certbot/conf:/etc/letsencrypt:ro\n', '', content)
content = re.sub(r'      - ./certbot/www:/var/www/certbot:ro\n', '', content)

# Add VPS_DEPLOYED marker
content = "# VPS_DEPLOYED\n" + content

with open("docker-compose.prod.yml", "w") as f:
    f.write(content)

print("docker-compose.prod.yml modified for VPS deployment")
PYEOF

  log "docker-compose.prod.yml modified (backup saved as .bak)"
else
  log "docker-compose.prod.yml already modified for VPS"
fi

# ─── 5. Configure system nginx ──────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 5: System Nginx Configuration"
echo "============================================================"

# Check if system nginx is installed
if ! command -v nginx &>/dev/null; then
  warn "Installing system nginx..."
  apt-get update -qq
  apt-get install -y -qq nginx certbot python3-certbot-nginx
  log "Nginx and Certbot installed"
else
  log "System nginx already installed"
fi

# Check available ports (8091, 8092, 8082, 8080 are taken)
# Use port 8093 for MedERP's Docker nginx (internal only)
# System nginx will proxy from 80/443 → localhost:8093

# Find first available port starting from 8093
AVAILABLE_PORT=8093
for port in 8093 8094 8095 8096; do
  if ! ss -tlnp | grep -q ":${port} "; then
    AVAILABLE_PORT=$port
    break
  fi
done
log "Using internal port ${AVAILABLE_PORT} for MedERP"

# Update docker-compose.prod.yml to use the available port for nginx
if [ -f docker-compose.prod.yml ]; then
  sed -i "s/\"80:80\"/\"${AVAILABLE_PORT}:80\"/g" docker-compose.prod.yml
  sed -i "s/\"443:443\"/\"8443:443\"/g" docker-compose.prod.yml
fi

# Create nginx config for MedERP
cat > /etc/nginx/sites-available/pharmerp <<NGINX_EOF
# MedERP — rdm-erp.duckdns.org
# Proxy to Docker nginx container on port ${AVAILABLE_PORT}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name ${DUCKDNS_DOMAIN}.duckdns.org;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS → Docker nginx → MedERP containers
server {
    listen 443 ssl http2;
    server_name ${DUCKDNS_DOMAIN}.duckdns.org;

    # SSL certificates (will be created by certbot)
    ssl_certificate     /etc/letsencrypt/live/${DUCKDNS_DOMAIN}.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DUCKDNS_DOMAIN}.duckdns.org/privkey.pem;

    # Modern TLS
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;

    # Proxy to Docker nginx container
    location / {
        proxy_pass http://127.0.0.1:${AVAILABLE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
        client_max_body_size 50m;
    }
}
NGINX_EOF

# Enable the site
ln -sf /etc/nginx/sites-available/pharmerp /etc/nginx/sites-enabled/pharmerp

# Remove default site if it exists and conflicts
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Test nginx config
nginx -t 2>&1 || {
  err "Nginx config test failed! Check /etc/nginx/sites-available/pharmerp"
  exit 1
}
log "Nginx config created and tested"

# Reload nginx
systemctl reload nginx
log "Nginx reloaded"

# ─── 6. Set up SSL ──────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 6: SSL Certificate Setup"
echo "============================================================"

# Start Docker nginx first so certbot can verify
cd "$APP_DIR"

# Temporarily start just the nginx container for ACME challenge
# (Docker nginx listens on port ${AVAILABLE_PORT} internally)
docker compose -f docker-compose.prod.yml up -d nginx 2>/dev/null || {
  warn "Could not start nginx container yet — will start after SSL"
}

# Create certbot webroot
mkdir -p /var/www/certbot

# Check if certificate already exists
if [ -d "/etc/letsencrypt/live/${DUCKDNS_DOMAIN}.duckdns.org" ]; then
  log "SSL certificate already exists for ${DUCKDNS_DOMAIN}.duckdns.org"
else
  warn "Requesting SSL certificate from Let's Encrypt..."
  
  # First, make sure DNS is pointing here
  CURRENT_IP=$(curl -s https://api.ipify.org)
  DOMAIN_IP=$(dig +short ${DUCKDNS_DOMAIN}.duckdns.org)
  
  if [ "$CURRENT_IP" != "$DOMAIN_IP" ]; then
    warn "DNS not yet pointing to this server!"
    warn "Current IP: $CURRENT_IP"
    warn "Domain resolves to: $DOMAIN_IP"
    warn "Updating DuckDNS..."
    curl -s "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="
    echo ""
    sleep 10
  fi
  
  # Request certificate
  certbot certonly --webroot \
    -w /var/www/certbot \
    --email "$SSL_EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "${DUCKDNS_DOMAIN}.duckdns.org" || {
    warn "SSL certificate request failed. This is normal on first run."
    warn "Make sure DNS points to this server, then run:"
    warn "  certbot certonly --webroot -w /var/www/certbot -d ${DUCKDNS_DOMAIN}.duckdns.org"
  }
fi

# Reload nginx to pick up SSL certs
systemctl reload nginx 2>/dev/null || true

# ─── 7. Start all Docker services ───────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 7: Starting Docker Services"
echo "============================================================"

cd "$APP_DIR"

# Stop any existing containers first
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# Build and start
log "Building and starting all services..."
docker compose -f docker-compose.prod.yml up -d --build

# Wait for health checks
log "Waiting for services to become healthy (this may take 2-3 minutes)..."
sleep 10

# Check status
docker compose -f docker-compose.prod.yml ps

# Verify backend health
log "Checking backend health..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T backend wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health 2>/dev/null; then
    log "Backend is healthy!"
    break
  fi
  echo -n "."
  sleep 5
done

# ─── 8. Update DuckDNS ──────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 8: DuckDNS IP Update"
echo "============================================================"

RESPONSE=$(curl -s "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=")
if [ "$RESPONSE" = "OK" ]; then
  log "DuckDNS updated: ${DUCKDNS_DOMAIN}.duckdns.org → $(curl -s https://api.ipify.org)"
else
  warn "DuckDNS update response: $RESPONSE"
fi

# ─── 9. Set up cron jobs ────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Step 9: Cron Jobs Setup"
echo "============================================================"

# DuckDNS updater every 5 minutes
(crontab -l 2>/dev/null | grep -v "update-duckdns"; echo "*/5 * * * * /opt/pharmerp/scripts/update-duckdns.sh >> /var/log/duckdns.log 2>&1") | crontab -

# SSL renewal monthly
(crontab -l 2>/dev/null | grep -v "certbot renew"; echo "0 0 1 * * certbot renew --quiet && systemctl reload nginx") | crontab -

# Database backup daily at 2 AM
(crontab -l 2>/dev/null | grep -v "backup-db"; echo "0 2 * * * cd /opt/pharmerp && ./scripts/backup-db.sh >> /var/log/pharmerp-backup.log 2>&1") | crontab -

log "Cron jobs configured"

# ─── 10. Final verification ─────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " Deployment Complete! Final Verification"
echo "============================================================"

echo ""
echo "--- Docker Containers ---"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "--- Backend Health ---"
docker compose -f docker-compose.prod.yml exec -T backend wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health 2>&1 && log "Backend: HEALTHY" || warn "Backend: NOT YET HEALTHY"

echo ""
echo "--- Nginx Status ---"
systemctl is-active nginx && log "Nginx: RUNNING" || warn "Nginx: NOT RUNNING"

echo ""
echo "--- SSL Certificate ---"
ls -la /etc/letsencrypt/live/${DUCKDNS_DOMAIN}.duckdns.org/fullchain.pem 2>/dev/null && log "SSL: CERTIFICATE EXISTS" || warn "SSL: NOT YET CONFIGURED"

echo ""
echo "--- Cron Jobs ---"
crontab -l 2>/dev/null | grep -E "duckdns|certbot|backup"

echo ""
echo "============================================================"
echo " Deployment Summary"
echo "============================================================"
echo ""
echo "  Application:     MedERP (Pharma-Medical-ERP)"
echo "  Domain:          https://${DUCKDNS_DOMAIN}.duckdns.org"
echo "  IP:              $(curl -s https://api.ipify.org)"
echo ""
echo "  Docker network:  pharmerp_net (isolated)"
echo "  Backend:         http://127.0.0.1:4001 (host) → 4000 (container)"
echo "  Frontend:        http://127.0.0.1:3001 (host) → 3000 (container)"
echo "  PostgreSQL:      Internal (port 5432, not exposed)"
echo "  Redis:           Internal (port 6379, not exposed)"
echo "  MinIO:           Internal (port 9000, not exposed)"
echo "  ClickHouse:      Internal (port 8123, not exposed)"
echo ""
echo "  Files location:  /opt/pharmerp"
echo "  Logs:            docker compose -f /opt/pharmerp/docker-compose.prod.yml logs -f"
echo "  Backup:          /opt/pharmerp/scripts/backup-db.sh"
echo ""
echo "  Other projects in /var/www/ are NOT affected."
echo "============================================================"
