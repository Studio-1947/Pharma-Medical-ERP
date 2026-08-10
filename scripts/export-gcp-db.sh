#!/usr/bin/env bash
# ==============================================================================
# GCP Cloud SQL / External Postgres Database Dump & Export Script
# ==============================================================================
set -e

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_DIR="./backups/postgres"
OUTPUT_FILE="${OUTPUT_DIR}/gcp_cloudsql_export_${TIMESTAMP}.sql.gz"

mkdir -p "${OUTPUT_DIR}"

echo "============================================================"
echo " GCP Cloud SQL Database Export Utility"
echo "============================================================"

# Read source database connection string
SOURCE_URL="${1:-${DATABASE_URL_PROD}}"

if [ -z "${SOURCE_URL}" ]; then
  echo "Usage: ./scripts/export-gcp-db.sh <GCP_DATABASE_URL>"
  echo "Example: ./scripts/export-gcp-db.sh 'postgresql://postgres:password@10.x.x.x:5432/pharmerp'"
  echo "Or set DATABASE_URL_PROD in your environment."
  exit 1
fi

echo "[1/2] Dumping database from GCP Cloud SQL..."
pg_dump "${SOURCE_URL}" --clean --if-exists --no-owner --no-privileges | gzip -9 > "${OUTPUT_FILE}"

FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)

echo "[2/2] Export successful!"
echo "------------------------------------------------------------"
echo " Backup File: ${OUTPUT_FILE}"
echo " Size:        ${FILE_SIZE}"
echo "------------------------------------------------------------"
echo " Next Step: Transfer to Hostinger VPS:"
echo " scp ${OUTPUT_FILE} root@187.127.185.82:/opt/pharmerp/backups/postgres/"
echo "============================================================"
