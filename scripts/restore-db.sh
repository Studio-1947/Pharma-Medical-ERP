#!/usr/bin/env bash
# ==============================================================================
# PostgreSQL Single-Command Database Restoration Script for PharmaERP
# ==============================================================================
set -e

BACKUP_DIR="./backups/postgres"
CONTAINER_NAME="pharmerp_postgres_prod"
DB_USER="${DB_USER:-pharmerp}"
DB_NAME="${DB_NAME:-pharmerp}"

echo "============================================================"
echo " PharmaERP Database Restoration & Fallback Utility"
echo "============================================================"

# Check container running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Container '${CONTAINER_NAME}' is not running!"
  echo "Start your containers first: docker compose -f docker-compose.prod.yml up -d"
  exit 1
fi

# Select backup file
TARGET_FILE="$1"

if [ -z "${TARGET_FILE}" ]; then
  echo "Available Backup Snapshots in ${BACKUP_DIR}:"
  echo "------------------------------------------------------------"
  
  if [ ! -d "${BACKUP_DIR}" ] || [ -z "$(ls -A "${BACKUP_DIR}")" ]; then
    echo "No backup files found in ${BACKUP_DIR}."
    exit 1
  fi

  select file in $(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null); do
    if [ -n "${file}" ]; then
      TARGET_FILE="${file}"
      break
    else
      echo "Invalid selection. Exiting."
      exit 1
    fi
  done
fi

if [ ! -f "${TARGET_FILE}" ]; then
  echo "Error: Backup file '${TARGET_FILE}' does not exist!"
  exit 1
fi

echo "------------------------------------------------------------"
echo " Target Snapshot: ${TARGET_FILE}"
echo " Database:        ${DB_NAME}"
echo " Container:       ${CONTAINER_NAME}"
echo "------------------------------------------------------------"
echo " WARNING: THIS WILL OVERWRITE CURRENT DATA IN '${DB_NAME}'!"
read -p " Are you sure you want to proceed? (type 'yes' to confirm): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "Restoration cancelled by user."
  exit 0
fi

echo "============================================================"
echo "[1/3] Resetting public schema in database..."
docker exec -t "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "[2/3] Restoring database snapshot..."
gunzip -c "${TARGET_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"

echo "[3/3] Running database migrations check..."
# Restart backend container to ensure Drizzle migrations and connection pools re-initialize
docker compose -f docker-compose.prod.yml restart backend

echo "============================================================"
echo " Restoration Complete! Database successfully restored to:"
echo " ${TARGET_FILE}"
echo "============================================================"
