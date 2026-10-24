#!/usr/bin/env bash
# One current-checkout/dedicated-clone QA entrypoint. Never reset user changes/data.
set -Eeuo pipefail
MODE="${1:-help}"; if [[ $# -gt 0 ]]; then shift; fi
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CHECKOUT="$SCRIPT_ROOT"
QA_ROOT="${NEXTTASK_QA_ROOT:-${TMPDIR:-/tmp}/nexttask-beta-qa}"
REF='main'; PORT=3002; ENV_FILE=''; DEDICATED=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) QA_ROOT="$2"; DEDICATED=true; shift 2;;
    --ref) REF="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --env-file) ENV_FILE="$2"; shift 2;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2;;
  esac
done
case "$MODE" in help|setup|test|serve|status) ;; *) printf 'Use help/setup/test/serve/status.\n' >&2; exit 2;; esac
if [[ "$MODE" == help ]]; then
  printf '%s\n' 'Usage: bash scripts/qa-integrated-beta.sh setup|test|serve|status [--root PATH] [--ref main|codex/integrated-beta] [--port 3002] [--env-file PATH]'
  printf '%s\n' 'Default: current checkout, preserving local changes. --root makes a dedicated clone. setup installs frozen dependencies and matched Chromium; test runs local code; serve uses isolated QA SQLite and allows guest mode without credentials.'
  exit 0
fi
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1024 && "$PORT" -le 65535 ]] || { printf 'Invalid port.\n' >&2; exit 2; }
mkdir -p "$QA_ROOT"; QA_ROOT="$(cd "$QA_ROOT" && pwd -P)"
if [[ "$DEDICATED" == true ]]; then
  CHECKOUT="$QA_ROOT/checkout"
  if [[ ! -d "$CHECKOUT/.git" ]]; then
    [[ "$MODE" == setup ]] || { printf 'Run setup first.\n' >&2; exit 1; }
    git clone --branch "$REF" --single-branch https://github.com/pbangiola/nexttask.git "$CHECKOUT"
  elif [[ "$MODE" == setup ]]; then
    [[ -z "$(git -C "$CHECKOUT" status --porcelain)" ]] || { printf 'Local changes preserved. Use test or serve.\n' >&2; exit 1; }
    [[ "$(git -C "$CHECKOUT" branch --show-current)" == "$REF" ]] || { printf 'Ref differs; not switching your checkout.\n' >&2; exit 1; }
    git -C "$CHECKOUT" fetch origin "$REF"
    git -C "$CHECKOUT" merge --ff-only FETCH_HEAD
  fi
fi
cd "$CHECKOUT"
printf 'Checkout: %s\n' "$CHECKOUT"; git status --short --branch; git log -1 --format='%h %s'
if [[ "$MODE" == status ]]; then printf 'QA data: %s/data\n' "$QA_ROOT"; exit 0; fi
[[ "$(node -p 'process.versions.node')" == "$(tr -d '\r\n' < .nvmrc)" ]] || { printf 'Use Node %s: nvm install && nvm use\n' "$(tr -d '\r\n' < .nvmrc)" >&2; exit 1; }
export PLAYWRIGHT_BROWSERS_PATH="$QA_ROOT/browsers"
if [[ "$MODE" == setup ]]; then
  npm ci
  node node_modules/playwright/cli.js install chromium
fi
[[ -d node_modules ]] || { printf 'Run setup first.\n' >&2; exit 1; }
if [[ "$MODE" == test || "$MODE" == setup ]]; then
  mkdir -p "$QA_ROOT/logs"
  export CHROMIUM_PATH="${CHROMIUM_PATH:-$(node -p 'require("playwright").chromium.executablePath()')}"
  printf 'Browser: %s\n' "$CHROMIUM_PATH"
  { while IFS= read -r -d '' file; do node --check "$file"; done < <(git ls-files -z --cached --others --exclude-standard '*.js'); git diff --check; npm test; } 2>&1 | tee "$QA_ROOT/logs/verification-$(date +%Y%m%d-%H%M%S).log"
  exit 0
fi
if [[ "$MODE" == serve ]]; then
  ENV_ARGS=()
  if [[ -n "$ENV_FILE" ]]; then
    [[ -f "$ENV_FILE" ]] || { printf 'Environment file not found.\n' >&2; exit 1; }
    ENV_ARGS=("--env-file=$(cd "$(dirname "$ENV_FILE")" && pwd -P)/$(basename "$ENV_FILE")")
  fi
  mkdir -p "$QA_ROOT/data"
  export RAILWAY_VOLUME_MOUNT_PATH="$QA_ROOT/data" PORT
  export FRONTEND_ORIGINS="http://localhost:$PORT,http://127.0.0.1:$PORT"
  printf 'Open http://localhost:%s; isolated data: %s. Stop with Ctrl-C.\n' "$PORT" "$RAILWAY_VOLUME_MOUNT_PATH"
  printf 'Guest works without Clerk; use a development Clerk instance for sign-in. Credentials are never printed.\n'
  node "${ENV_ARGS[@]}" backend/server.js
fi
