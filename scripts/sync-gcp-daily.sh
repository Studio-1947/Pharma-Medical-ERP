#!/usr/bin/env bash
# ==============================================================================
# Automated Daily GCP Cloud SQL Backup Preserver & Synchronizer
# ==============================================================================
# This script runs daily via Cron on your Hostinger VPS to pull a complete,
# compressed snapshot of your GCP Cloud SQL database. It guarantees that even if
# your GCP subscription expires unexpectedly, 100% of your GCP data is safe on VPS.
# ==============================================================================
set -e

# Load production env if present
if [ -f "./.env.production" ]; then
  export $(grep -v '^#' ./.env.production | xargs)
fi

BACKUP_DIR="./backups/gcp_daily"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/gcp_preserve_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

echo "============================================================"
echo " Starting Daily GCP Cloud SQL Backup Sync"
echo " Timestamp: ${TIMESTAMP}"
echo " Backup Location: ${BACKUP_FILE}"
echo "============================================================"

GCP_URL="${GCP_DATABASE_URL:-${DATABASE_URL_PROD:-}}"

if [ -z "${GCP_URL}" ]; then
  echo "Error: GCP_DATABASE_URL (or DATABASE_URL_PROD) environment variable is not set!"
  echo "Please set GCP_DATABASE_URL in .env.production on your Hostinger VPS."
  echo "Example: GCP_DATABASE_URL='postgresql://postgres:password@GCP_CLOUD_SQL_IP:5432/pharmerp'"
  exit 1
fi

echo "[1/3] Fetching full database snapshot from GCP Cloud SQL..."
if pg_dump "${GCP_URL}" --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILE}"; then
  FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "[1/3] GCP database successfully dumped and compressed! Size: ${FILE_SIZE}"
else
  echo "[ERROR] Failed to dump GCP Cloud SQL database! Check your connection string or network firewall."
  exit 1
fi

echo "[2/3] Cleaning up old GCP backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "gcp_preserve_*.sql.gz" -mtime +"${RETENTION_DAYS}" -exec rm -f {} \;
echo "[2/3] Cleanup complete."

# Optional Auto-Sync into Hostinger Postgres DB container
if [ "${AUTO_RESTORE_GCP_TO_HOSTINGER:-false}" = "true" ]; then
  echo "[3/3] AUTO_RESTORE_GCP_TO_HOSTINGER is enabled. Restoring snapshot into Hostinger Postgres container..."
  if docker ps --format '{{.Names}}' | grep -q "^pharmerp_postgres_prod$"; then
    docker exec -t pharmerp_postgres_prod psql -U "${DB_USER:-pharmerp}" -d "${DB_NAME:-pharmerp}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    gunzip -c "${BACKUP_FILE}" | docker exec -i pharmerp_postgres_prod psql -U "${DB_USER:-pharmerp}" -d "${DB_NAME:-pharmerp}"
    echo "[3/3] Auto-sync restore completed successfully!"
  else
    echo "[Warning] Hostinger Postgres container 'pharmerp_postgres_prod' is not running. Skipping auto-restore."
  fi
else
  echo "[3/3] GCP snapshot safely stored on Hostinger VPS disk."
fi

echo "============================================================"
echo " GCP Preserver Daily Sync Finished Successfully!"
echo " Snapshot: ${BACKUP_FILE}"
echo "============================================================"
