#!/usr/bin/env bash
# ==============================================================================
# Automatic Deployment & Container Refresh Script for Hostinger VPS
# ==============================================================================
set -e

APP_DIR="/opt/pharmerp"
BRANCH="main"

echo "============================================================"
echo " Starting Automatic Deployment on Hostinger VPS"
echo " Timestamp: $(date)"
echo " Workspace: ${APP_DIR}"
echo " Branch:    ${BRANCH}"
echo "============================================================"

cd "${APP_DIR}"

# 1. Fetch latest changes from private git repository
echo "[1/5] Fetching latest code from GitHub..."
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

# 2. Grant executable permissions to all scripts
chmod +x scripts/*.sh

# 3. Take a pre-deployment database backup for safety
echo "[2/5] Creating pre-deployment safety database backup..."
if [ -f "./scripts/backup-db.sh" ]; then
  ./scripts/backup-db.sh || echo "Warning: Pre-deploy database backup failed or container not yet running. Continuing..."
fi

# 4. Rebuild and launch production containers
echo "[3/5] Building and updating Docker containers..."
docker compose -f docker-compose.prod.yml up -d --build

# 5. Clean up old unused build images to save disk space on VPS
echo "[4/5] Pruning dangling Docker images..."
docker image prune -f

# 6. Verify container health
echo "[5/5] Performing API health check..."
sleep 5
docker compose -f docker-compose.prod.yml exec -T backend wget --no-verbose --tries=3 --spider http://localhost:4000/api/v1/health || {
  echo "Error: Backend health check failed after deployment!"
  exit 1
}

echo "============================================================"
echo " Deployment Successfully Completed!"
echo "============================================================"
