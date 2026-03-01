#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${ESPADA_IMAGE:-espada:local}"
CONFIG_DIR="${ESPADA_CONFIG_DIR:-$HOME/.espada}"
WORKSPACE_DIR="${ESPADA_WORKSPACE_DIR:-$HOME/espada}"
PROFILE_FILE="${ESPADA_PROFILE_FILE:-$HOME/.profile}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e ESPADA_LIVE_TEST=1 \
  -e ESPADA_LIVE_MODELS="${ESPADA_LIVE_MODELS:-all}" \
  -e ESPADA_LIVE_PROVIDERS="${ESPADA_LIVE_PROVIDERS:-}" \
  -e ESPADA_LIVE_MODEL_TIMEOUT_MS="${ESPADA_LIVE_MODEL_TIMEOUT_MS:-}" \
  -e ESPADA_LIVE_REQUIRE_PROFILE_KEYS="${ESPADA_LIVE_REQUIRE_PROFILE_KEYS:-}" \
  -v "$CONFIG_DIR":/home/node/.espada \
  -v "$WORKSPACE_DIR":/home/node/espada \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
