#!/usr/bin/env bash
# ==============================================================================
# Manual PostgreSQL Database Backup Script for PharmaERP
# ==============================================================================
set -e

BACKUP_DIR="./backups/postgres"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
CONTAINER_NAME="pharmerp_postgres_prod"
DB_USER="${DB_USER:-pharmerp}"
DB_NAME="${DB_NAME:-pharmerp}"
BACKUP_FILENAME="pharmerp_manual_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "============================================================"
echo " Starting Database Backup..."
echo " Container: ${CONTAINER_NAME}"
echo " Database:  ${DB_NAME}"
echo " Timestamp: ${TIMESTAMP}"
echo "============================================================"

# Check if target postgres container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Container '${CONTAINER_NAME}' is not running!"
  echo "Make sure your production stack is up: docker compose -f docker-compose.prod.yml up -d"
  exit 1
fi

# Execute pg_dump inside container and pipe through gzip
echo "[1/2] Dumping database and compressing..."
docker exec -t "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${BACKUP_PATH}"

# Check backup file size
FILE_SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)

echo "[2/2] Backup created successfully!"
echo "------------------------------------------------------------"
echo " Location: ${BACKUP_PATH}"
echo " Size:     ${FILE_SIZE}"
echo "============================================================"
