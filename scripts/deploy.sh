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

PREVIOUS_REVISION="$(git rev-parse HEAD 2>/dev/null || true)"

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

  compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 backend frontend
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
TARGET_REVISION="$(git rev-parse "origin/${BRANCH}")"

backend_changed=false
frontend_changed=false
database_changed=false

if [ -z "${PREVIOUS_REVISION}" ] || ! git cat-file -e "${PREVIOUS_REVISION}^{commit}" 2>/dev/null; then
  backend_changed=true
  frontend_changed=true
  database_changed=true
else
  changed_files="$(git diff --name-only "${PREVIOUS_REVISION}" "${TARGET_REVISION}")"
  if grep -Eq '^(backend/|packages/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|docker-compose\.prod\.yml$|\.dockerignore$)' <<<"${changed_files}"; then
    backend_changed=true
  fi
  if grep -Eq '^(frontend/|packages/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|docker-compose\.prod\.yml$|\.dockerignore$)' <<<"${changed_files}"; then
    frontend_changed=true
  fi
  if grep -Eq '^backend/(drizzle/|src/database/schema/)' <<<"${changed_files}"; then
    database_changed=true
  fi
fi

git reset --hard "${TARGET_REVISION}"

services=()
${backend_changed} && services+=(backend)
${frontend_changed} && services+=(frontend)

if [ "${#services[@]}" -eq 0 ]; then
  echo "No application, shared-package, dependency, or container changes detected. Nothing to deploy."
  exit 0
fi

echo "Changed services: ${services[*]}"

# 2. Grant executable permissions to all scripts
chmod +x scripts/*.sh

# 3. A database dump is valuable before schema changes, but dumping the entire
# database for a CSS/component-only deploy is pure downtime and disk churn.
if ${database_changed}; then
  echo "[2/5] Database changes detected; creating pre-deployment safety backup..."
  if [ -f "./scripts/backup-db.sh" ]; then
    ./scripts/backup-db.sh || echo "Warning: Pre-deploy database backup failed or container not yet running. Continuing..."
  fi
else
  echo "[2/5] No database changes; skipping pre-deployment backup."
fi

# 4. Rebuild and launch production containers
echo "[3/5] Building and updating Docker containers..."
save_rollback_images
if [ -n "${PREBUILT_BACKEND_IMAGE:-}" ] || [ -n "${PREBUILT_FRONTEND_IMAGE:-}" ]; then
  # CI-built images keep expensive TypeScript/Next compilation off the small
  # VPS. Save rollback tags first, then atomically retag each downloaded image
  # to the stable names used by Compose.
  for service in "${services[@]}"; do
    if [ "${service}" = backend ]; then
      source_image="${PREBUILT_BACKEND_IMAGE:?PREBUILT_BACKEND_IMAGE is required}"
    else
      source_image="${PREBUILT_FRONTEND_IMAGE:?PREBUILT_FRONTEND_IMAGE is required}"
    fi
    echo "Pulling prebuilt ${service} image: ${source_image}"
    docker pull "${source_image}"
    docker image tag "${source_image}" "pharmerp-${service}:current"
  done
else
  # Manual deployments remain supported when no registry image was supplied.
  if ! compose build "${services[@]}"; then
    fail_and_rollback "one or more images failed to build."
  fi
fi
if ! compose up -d --no-deps --no-build --wait --wait-timeout 180 "${services[@]}"; then
  fail_and_rollback "one or more containers did not become healthy."
fi

# 5. Verify container health and the real route users hit.
echo "[4/5] Verifying API and frontend upstreams..."
if ! compose exec -T backend node -e "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
  || ! compose exec -T frontend node -e "fetch('http://127.0.0.1:3000').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
  fail_and_rollback "deployment completed but an application upstream is not reachable."
fi

# 6. Clean up only dangling images. The :rollback tags are intentionally kept
# so the next failed deployment can be restored without pulling or rebuilding.
echo "[5/5] Pruning dangling Docker images..."
docker image prune -f

echo "============================================================"
echo " Deployment Successfully Completed!"
echo "============================================================"
