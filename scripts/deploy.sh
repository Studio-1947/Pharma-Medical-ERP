#!/usr/bin/env bash
# ==============================================================================
# Automatic Deployment & Container Refresh Script for Hostinger VPS
# ==============================================================================
set -euo pipefail

APP_DIR="/opt/pharmerp"
BRANCH="main"

echo "============================================================"
echo " Starting Automatic Deployment on Hostinger VPS"
echo " Timestamp: $(date)"
echo " Workspace: ${APP_DIR}"
echo " Branch:    ${BRANCH}"
echo "============================================================"

cd "${APP_DIR}"

compose() {
  docker compose -f docker-compose.prod.yml "$@"
}

show_failure_diagnostics() {
  echo ""
  echo "================ DEPLOYMENT DIAGNOSTICS ================"
  compose ps || true
  echo ""
  echo "--- backend logs (last 150 lines) ---"
  compose logs --tail=150 backend || true
  echo ""
  echo "--- frontend logs (last 150 lines) ---"
  compose logs --tail=150 frontend || true
  echo ""
  echo "--- nginx logs (last 150 lines) ---"
  compose logs --tail=150 nginx || true
  echo "=========================================================="
}

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
if ! compose up -d --build --wait --wait-timeout 180; then
  echo "Error: one or more containers did not become healthy."
  show_failure_diagnostics
  exit 1
fi

# 5. Clean up old unused build images to save disk space on VPS
echo "[4/5] Pruning dangling Docker images..."
docker image prune -f

# 6. Verify container health
echo "[5/5] Verifying API, frontend, and nginx routing..."
if ! compose exec -T backend wget --no-verbose --tries=3 --spider http://localhost:4000/api/v1/health \
  || ! compose exec -T frontend wget --no-verbose --tries=3 --spider http://localhost:3000 \
  || ! compose exec -T nginx wget --no-check-certificate --no-verbose --tries=3 --spider https://localhost/; then
  echo "Error: deployment completed but the application is not reachable through nginx."
  show_failure_diagnostics
  exit 1
fi

echo "============================================================"
echo " Deployment Successfully Completed!"
echo "============================================================"
