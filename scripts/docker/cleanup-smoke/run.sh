#!/usr/bin/env bash
set -euo pipefail

cd /repo

export ESPADA_STATE_DIR="/tmp/espada-test"
export ESPADA_CONFIG_PATH="${ESPADA_STATE_DIR}/espada.json"

echo "==> Seed state"
mkdir -p "${ESPADA_STATE_DIR}/credentials"
mkdir -p "${ESPADA_STATE_DIR}/agents/main/sessions"
echo '{}' >"${ESPADA_CONFIG_PATH}"
echo 'creds' >"${ESPADA_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${ESPADA_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm espada reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${ESPADA_CONFIG_PATH}"
test ! -d "${ESPADA_STATE_DIR}/credentials"
test ! -d "${ESPADA_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${ESPADA_STATE_DIR}/credentials"
echo '{}' >"${ESPADA_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm espada uninstall --state --yes --non-interactive

test ! -d "${ESPADA_STATE_DIR}"

echo "OK"
