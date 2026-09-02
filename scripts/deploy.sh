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
  docker compose --env-file .env.production -f docker-compose.prod.yml "$@"
}

if [ ! -r .env.production ]; then
  echo "Error: /opt/pharmerp/.env.production is missing or unreadable. Deployment stopped."
  exit 1
fi

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

save_rollback_images() {
  # Capture the images used by the currently running containers *before* the
  # build updates the :current tags. This also supports hosts deployed before
  # explicit image tags were added to compose.
  for service in backend frontend; do
    container="pharmerp_${service}"
    rollback_tag="pharmerp-${service}:rollback"
    image_id="$(docker inspect --format '{{.Image}}' "${container}" 2>/dev/null || true)"

    if [ -n "${image_id}" ]; then
      docker image tag "${image_id}" "${rollback_tag}"
      echo "Saved ${service} rollback image: ${rollback_tag}"
    else
      echo "No existing ${service} container; automatic rollback is unavailable on this first deploy."
    fi
  done
}

rollback() {
  if ! docker image inspect pharmerp-backend:rollback >/dev/null 2>&1 \
    || ! docker image inspect pharmerp-frontend:rollback >/dev/null 2>&1; then
    echo "No complete rollback image set is available."
    return 1
  fi

  echo "Restoring the previously running backend and frontend images..."
  docker image tag pharmerp-backend:rollback pharmerp-backend:current
  docker image tag pharmerp-frontend:rollback pharmerp-frontend:current

  compose up -d --no-build --force-recreate --wait --wait-timeout 180 nginx backend frontend
}

fail_and_rollback() {
  echo "Error: $1"
  show_failure_diagnostics

  if rollback; then
    echo "Rollback completed: the last known-good application images are running again."
  else
    echo "Rollback could not be completed. Keep the diagnostics above and follow the VPS runbook."
  fi
  exit 1
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
save_rollback_images
if ! compose up -d --build --wait --wait-timeout 180; then
  fail_and_rollback "one or more containers did not become healthy."
fi

# 5. Verify container health and the real route users hit.
echo "[4/5] Verifying API, frontend, and nginx routing..."
if ! compose exec -T backend node -e "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
  || ! compose exec -T frontend wget --no-verbose --tries=3 --spider http://localhost:3000 \
  || ! compose exec -T nginx wget --no-check-certificate --no-verbose --tries=3 --spider https://localhost/; then
  fail_and_rollback "deployment completed but the application is not reachable through nginx."
fi

# 6. Clean up only dangling images. The :rollback tags are intentionally kept
# so the next failed deployment can be restored without pulling or rebuilding.
echo "[5/5] Pruning dangling Docker images..."
docker image prune -f

echo "============================================================"
echo " Deployment Successfully Completed!"
echo "============================================================"
