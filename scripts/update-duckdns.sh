#!/usr/bin/env bash
# ==============================================================================
# DuckDNS IP Dynamic Updater Script for PharmaERP Hostinger VPS
# ==============================================================================

# Load environment variables if available
if [ -f "./.env.production" ]; then
  export $(grep -v '^#' ./.env.production | xargs)
fi

DOMAIN="${DUCKDNS_DOMAIN:-rdm-erp}"
TOKEN="${DUCKDNS_TOKEN:-f31057c7-fa09-4b76-a8af-e1d30b9c982a}"

echo "[$(date)] Updating DuckDNS domain: ${DOMAIN}.duckdns.org..."
RESPONSE=$(curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=")

if [ "${RESPONSE}" = "OK" ]; then
  echo "[$(date)] DuckDNS update successful! Response: OK"
else
  echo "[$(date)] DuckDNS update failed! Response: ${RESPONSE}"
  exit 1
fi
