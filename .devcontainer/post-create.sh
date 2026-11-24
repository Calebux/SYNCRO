#!/usr/bin/env bash
# SYNCRO v3 post-create bootstrap for GitHub Codespaces and VS Code Dev Containers.
#
# Runs once when the container is created:
#   1. installs workspace dependencies and writes env files (npm run bootstrap)
#   2. starts the local v3 stack (Postgres, Redis, Soroban RPC, backend, mock provider)
#   3. runs the v3 seed so the demo principal/agent/channel exist
#   4. reports the toolchain state with npm run doctor
#
# The image already contains Node 20, Rust 1.91.0 + 1.81.0, wasm32-unknown-unknown,
# and Stellar CLI 23.0.0, so contract and SDK tests need no manual installs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STARTED_AT=$(date +%s)
log() { printf '\n[devcontainer] %s\n' "$*"; }

log "Node $(node --version) · npm $(npm --version)"
log "Rust $(rustc --version)"
log "Stellar CLI $(stellar version 2>/dev/null | head -n 1 || echo 'not found')"

# docker-in-docker can still be starting when postCreate runs.
log "Waiting for the Docker daemon…"
DOCKER_READY=0
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    DOCKER_READY=1
    break
  fi
  sleep 2
done
if [ "$DOCKER_READY" -eq 0 ]; then
  log "Docker daemon is not ready; skipping the stack and seed. Run 'npm run bootstrap' once Docker is up."
fi

# Dependencies, env templates, stack startup, and the seed all live in bootstrap.mjs.
log "Running npm run bootstrap (install, env, v3 stack, seed)…"
npm run bootstrap

# Re-run the seed explicitly: bootstrap starts Compose in the background, and on
# a cold first boot the one-shot seed can finish before the stack is ready.
if [ "$DOCKER_READY" -eq 1 ]; then
  log "Running the v3 seed…"
  if docker compose run --rm seed; then
    log "v3 seed complete."
  else
    log "Seed did not complete. Re-run 'docker compose run --rm seed' after the stack is healthy."
  fi
fi

log "Verifying the toolchain (npm run doctor)…"
npm run doctor || log "doctor reported issues above; see CONTRIBUTING.md#dev-container--codespaces"

ELAPSED=$(( $(date +%s) - STARTED_AT ))
log "Post-create finished in ${ELAPSED}s."
log "Contract tests: (cd contracts && cargo test)"
log "SDK tests:      npm test -w sdk"
log "Backend:        npm run dev -w backend  (http://localhost:3001)"
log "Client:         npm run dev -w client   (http://localhost:3000)"
