#!/usr/bin/env bash
# ==============================================================================
# Bootstrap Let's Encrypt SSL Certificates via Certbot for DuckDNS Subdomain
# ==============================================================================
set -e

# Load production env
if [ -f "./.env.production" ]; then
  export $(grep -v '^#' ./.env.production | xargs)
fi

DOMAIN="${DUCKDNS_DOMAIN:-}"
EMAIL="${SSL_EMAIL:-admin@${DOMAIN}.duckdns.org}"

if [ -z "${DOMAIN}" ]; then
  read -p "Enter your DuckDNS subdomain name (without .duckdns.org): " DOMAIN
fi

if [ -z "${EMAIL}" ]; then
  read -p "Enter your notification email address for Let's Encrypt: " EMAIL
fi

FULL_DOMAIN="${DOMAIN}.duckdns.org"

echo "============================================================"
echo " Bootstrapping Let's Encrypt SSL for ${FULL_DOMAIN}"
echo " Email: ${EMAIL}"
echo "============================================================"

# Prepare certificate directories
mkdir -p ./certbot/www
mkdir -p ./certbot/conf

echo "[1/3] Starting lightweight HTTP Nginx server for ACME challenge..."
docker compose -f docker-compose.prod.yml up -d nginx

echo "[2/3] Requesting SSL Certificate from Let's Encrypt..."
docker run -it --rm --name certbot \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${FULL_DOMAIN}"

echo "[3/3] Reloading Nginx configuration..."
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "============================================================"
echo " SSL Certificate successfully issued for ${FULL_DOMAIN}!"
echo " Certificates are stored in ./certbot/conf/live/${FULL_DOMAIN}/"
echo "============================================================"
