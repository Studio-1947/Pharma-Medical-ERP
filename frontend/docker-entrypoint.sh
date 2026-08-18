#!/bin/sh
# =============================================================================
# Frontend container entrypoint -- Next.js static asset retention
# =============================================================================
#
# The problem
# -----------
# Every deploy builds a fresh image, so the previous build's /_next/static/*
# files disappear the moment the new container replaces the old one. A browser
# still running the previous build -- a POS tab left open across a deploy, or an
# installed PWA resuming from cache -- then requests a chunk that no longer
# exists and hard-fails with ChunkLoadError. Chunk filenames are content-hashed,
# so builds can coexist safely; they just have to still be on disk.
#
# The approach
# ------------
# Given any writable directory that outlives the container, this script:
#
#   publish : this build's assets  -> archive   (adds, never deletes)
#   restore : archive              -> .next/static (only what this build lacks)
#   prune   : archive              -> drop assets no recent deploy shipped
#
# The restore step is what makes this host-agnostic: the Next.js server itself
# ends up able to serve older builds' assets, so nothing depends on a particular
# reverse proxy or volume driver. It works the same on a VPS Docker volume, a
# Cloud Run GCS FUSE mount, Filestore, or a Kubernetes PVC.
#
# Safety
# ------
# This is a resilience feature; it must never be the reason the app is down.
#   * Disabled unless the archive directory actually exists, so an unconfigured
#     environment is a strict no-op.
#   * A read-only archive still serves restores; only publish/prune are skipped.
#   * Every step is best-effort. Failures log and continue.
#   * The whole block runs with errexit disabled and the server is exec'd
#     unconditionally, so no failure here can stop the container from booting.
#
# Tuning (all optional)
#   NEXT_STATIC_ARCHIVE        archive path; empty disables the feature entirely
#   NEXT_STATIC_RETENTION_DAYS days to keep an asset after its last deploy (30)
#   NEXT_STATIC_MAX_FILES      refuse to restore an archive larger than this
# =============================================================================

set -eu

ARCHIVE_ROOT="${NEXT_STATIC_ARCHIVE-/var/www/next-static-root}"
ARCHIVE_STATIC="${ARCHIVE_ROOT}/_next/static"

# Served by the Next.js server. Restores land here.
LIVE_STATIC="/app/frontend/.next/static"
# Exactly what this image shipped; never written to at runtime.
PRISTINE_STATIC="/app/frontend/.next/static-pristine"

RETENTION_DAYS="${NEXT_STATIC_RETENTION_DAYS:-30}"
MAX_FILES="${NEXT_STATIC_MAX_FILES:-20000}"

log() { echo "[static-archive] $*"; }

count_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

# Copy every file present in $1 but missing from $2, preserving layout.
#
# This is deliberately an explicit walk rather than `cp -Rn`. Busybox's cp,
# which is what Alpine ships, treats `cp -Rn src/. dst/` as "dst exists, skip"
# and silently copies nothing while still exiting 0 -- a no-op that looks like
# success. Doing it by hand behaves identically on busybox and GNU coreutils.
#
# Cheap in practice: content-hashed names mean an existing file already holds
# the right bytes, so a steady-state start copies almost nothing. It is also
# safe when several instances start at once against shared storage, which
# matters on Cloud Run.
merge_missing() {
  _src="$1"
  _dst="$2"

  ( cd "$_src" 2>/dev/null && find . -type f 2>/dev/null ) | while read -r rel; do
    if [ ! -f "$_dst/$rel" ]; then
      mkdir -p "$_dst/$(dirname "$rel")" 2>/dev/null || continue
      cp "$_src/$rel" "$_dst/$rel" 2>/dev/null || true
    fi
  done
}

# Publish this build's assets into the archive.
publish() {
  mkdir -p "$ARCHIVE_STATIC" 2>/dev/null || true

  _before=$(count_files "$ARCHIVE_STATIC")
  merge_missing "$PUBLISH_SRC" "$ARCHIVE_STATIC"
  _after=$(count_files "$ARCHIVE_STATIC")

  # Mark everything this build ships as live so prune spares it. Needed because
  # merge_missing skips files that already exist, which leaves their mtime at
  # whatever an earlier deploy set. Batched into one touch pass.
  ( cd "$PUBLISH_SRC" 2>/dev/null && find . -type f 2>/dev/null ) \
    | sed "s|^\./|${ARCHIVE_STATIC}/|" \
    | xargs -r touch 2>/dev/null || true

  log "published this build: archive $_before -> $_after files"
}

# Restore older builds' assets so this container can serve them. Files this
# build already ships are never overwritten, so the current build always wins.
restore() {
  _archived=$(count_files "$ARCHIVE_STATIC")

  if [ "$_archived" -gt "$MAX_FILES" ] 2>/dev/null; then
    log "WARNING: archive holds $_archived files (limit $MAX_FILES), skipping restore"
    log "         lower NEXT_STATIC_RETENTION_DAYS or clear the archive"
    return 1
  fi

  _before=$(count_files "$LIVE_STATIC")
  merge_missing "$ARCHIVE_STATIC" "$LIVE_STATIC"
  _after=$(count_files "$LIVE_STATIC")

  log "serving $_after assets ($((_after - _before)) restored from previous builds)"
}

# Drop assets that no deploy has shipped for RETENTION_DAYS. Files belonging to
# the current build were just touched by publish(), so they are never candidates.
prune() {
  case "$RETENTION_DAYS" in
    ''|*[!0-9]*) log "invalid NEXT_STATIC_RETENTION_DAYS='$RETENTION_DAYS', skipping prune"; return 0 ;;
  esac
  [ "$RETENTION_DAYS" -gt 0 ] || { log "prune disabled"; return 0; }

  # Guarded: busybox find predicates vary across Alpine releases, and an
  # unsupported one must not take the container down.
  find "$ARCHIVE_STATIC" -type f -mtime "+${RETENTION_DAYS}" -exec rm -f {} + 2>/dev/null || true
  find "$ARCHIVE_STATIC" -type d -empty -exec rmdir {} + 2>/dev/null || true
  log "pruned assets unused for more than ${RETENTION_DAYS} days"
}

main() {
  if [ -z "$ARCHIVE_ROOT" ]; then
    log "disabled (NEXT_STATIC_ARCHIVE empty)"
    return 0
  fi

  if [ ! -d "$LIVE_STATIC" ]; then
    log "no build output at $LIVE_STATIC, skipping"
    return 0
  fi

  # Falls back to the live dir on images built before static-pristine existed.
  PUBLISH_SRC="$PRISTINE_STATIC"
  [ -d "$PUBLISH_SRC" ] || PUBLISH_SRC="$LIVE_STATIC"

  if [ ! -d "$ARCHIVE_ROOT" ]; then
    log "archive $ARCHIVE_ROOT not mounted, retention inactive"
    return 0
  fi

  # A read-only archive is still useful: restore works, publish and prune do not.
  #
  # Probed with a real write rather than `[ -w ]`, because this runs as root and
  # a permission-bit test reports a read-only *mount* as writable. Without the
  # probe the writes fail silently and the log claims a publish that never
  # happened.
  mkdir -p "$ARCHIVE_STATIC" 2>/dev/null || true
  if touch "$ARCHIVE_STATIC/.write-probe" 2>/dev/null; then
    rm -f "$ARCHIVE_STATIC/.write-probe" 2>/dev/null || true
    publish || true
    restore || true
    prune || true
  else
    log "archive is read-only, restoring without publishing"
    restore || true
  fi
}

# Best-effort by construction: never allow a retention failure to stop the app.
set +e
main
set -e

exec "$@"
