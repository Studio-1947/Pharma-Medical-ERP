#!/usr/bin/env bash
# ==============================================================================
# DuckDNS IP Dynamic Updater Script for PharmaERP Hostinger VPS
# ==============================================================================

# Load environment variables if available
if [ -f "./.env.production" ]; then
  export $(grep -v '^#' ./.env.production | xargs)
fi

DOMAIN="${DUCKDNS_DOMAIN:-}"
TOKEN="${DUCKDNS_TOKEN:-}"

if [ -z "${DOMAIN}" ] || [ -z "${TOKEN}" ]; then
  echo "Error: DUCKDNS_DOMAIN and DUCKDNS_TOKEN environment variables must be set!"
  echo "Example: DUCKDNS_DOMAIN=mypharmerp DUCKDNS_TOKEN=12345678-xxxx-xxxx"
  exit 1
fi

echo "[$(date)] Updating DuckDNS domain: ${DOMAIN}.duckdns.org..."
RESPONSE=$(curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=")

if [ "${RESPONSE}" = "OK" ]; then
  echo "[$(date)] DuckDNS update successful! Response: OK"
else
  echo "[$(date)] DuckDNS update failed! Response: ${RESPONSE}"
  exit 1
fi
