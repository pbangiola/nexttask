#!/usr/bin/env bash
# Dedicated local QA for codex/focus-durability. Run with bash; no chmod needed.
set -Eeuo pipefail
BRANCH='codex/focus-durability'
LABEL='focus-durability'
REPO_URL='https://github.com/pbangiola/nexttask.git'
DEFAULT_PORT=3002
MODE="${1:-setup}"
if [[ $# -gt 0 ]]; then shift; fi
QA_ROOT="${NEXTTASK_QA_ROOT:-$PWD/nexttask-qa}"
PORT="$DEFAULT_PORT"
ENV_FILE=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) [[ $# -ge 2 ]] || exit 2; QA_ROOT="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || exit 2; PORT="$2"; shift 2 ;;
    --env-file) [[ $# -ge 2 ]] || exit 2; ENV_FILE="$2"; shift 2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
case "$MODE" in setup|test|serve|status|help) ;; *) printf 'Use setup, test, serve, status, or help.\n' >&2; exit 2 ;; esac
if [[ "$MODE" == help ]]; then
  printf '%s\n' "Usage: bash $0 [setup|test|serve|status] [--root PATH] [--port PORT] [--env-file PATH]"
  printf '%s\n' 'setup: clone/update a dedicated clean checkout, install dependencies, run tests.'
  printf '%s\n' 'test: test current local changes without fetching or resetting.'
  printf '%s\n' 'serve: run current local code on loopback with a separate QA database.'
  printf '%s\n' 'status: show branch/commit/local changes, without installing or fetching.'
  exit 0
fi
[[ "$PORT" =~ ^[0-9]+$ ]] && [[ "$PORT" -ge 1024 && "$PORT" -le 65535 ]] || { printf 'Invalid port.\n' >&2; exit 2; }
mkdir -p "$QA_ROOT"
QA_ROOT="$(cd "$QA_ROOT" && pwd -P)"
CHECKOUT="$QA_ROOT/$LABEL"
DATA_DIR="$QA_ROOT/data-$LABEL"
LOG_DIR="$QA_ROOT/logs-$LABEL"
trap 'printf "\nQA command failed during %s. Your checkout and QA data have been preserved.\n" "$MODE" >&2' ERR
command -v git >/dev/null || { printf 'Install Git / Xcode command-line tools first.\n' >&2; exit 1; }

validate_checkout() {
  [[ -d "$CHECKOUT/.git" ]] || { printf 'Run setup first; expected dedicated clone: %s\n' "$CHECKOUT" >&2; exit 1; }
  local remote branch
  remote="$(git -C "$CHECKOUT" remote get-url origin)"
  case "$remote" in https://github.com/pbangiola/nexttask.git|https://github.com/pbangiola/nexttask|git@github.com:pbangiola/nexttask.git) ;; *)
    printf 'Refusing unrelated repository: %s\n' "$CHECKOUT" >&2; exit 1 ;; esac
  branch="$(git -C "$CHECKOUT" symbolic-ref --quiet --short HEAD || true)"
  [[ "$branch" == "$BRANCH" ]] || { printf 'Expected branch %s; found %s. Not switching it.\n' "$BRANCH" "$branch" >&2; exit 1; }
}
if [[ "$MODE" == setup ]]; then
  if [[ ! -e "$CHECKOUT" ]]; then
    git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$CHECKOUT"
  else
    validate_checkout
    [[ -z "$(git -C "$CHECKOUT" status --porcelain)" ]] || {
      printf 'Local changes exist. Not updating or overwriting them. Use test or serve instead.\n' >&2; exit 1; }
    git -C "$CHECKOUT" fetch origin "$BRANCH"
    git -C "$CHECKOUT" merge --ff-only FETCH_HEAD
  fi
fi
validate_checkout
printf '\nBranch: %s\nCheckout: %s\n' "$BRANCH" "$CHECKOUT"
git -C "$CHECKOUT" log -1 --format='%h %s'
if [[ "$MODE" == status ]]; then
  git -C "$CHECKOUT" status --short
  printf 'QA database directory: %s\nLogs: %s\n' "$DATA_DIR" "$LOG_DIR"
  exit 0
fi
command -v node >/dev/null && command -v npm >/dev/null || {
  printf 'Install Node 22.23.3, then rerun this script.\n' >&2; exit 1; }
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || {
  printf 'Node 22 is required; current version: %s\n' "$(node --version)" >&2
  printf 'If you use nvm: nvm install 22.23.3 && nvm use 22.23.3\n' >&2; exit 1; }
printf 'Runtime: %s\n' "$(node --version)"
cd "$CHECKOUT"
mkdir -p "$LOG_DIR"
if [[ "$MODE" == setup ]]; then
  npm ci
  # Install the browser matched to this branch's locked Playwright version.
  node node_modules/playwright/cli.js install chromium
fi
if [[ "$MODE" == setup || "$MODE" == test ]]; then
  [[ -d node_modules ]] || { printf 'Run setup to install dependencies.\n' >&2; exit 1; }
  LOG_FILE="$LOG_DIR/tests-$(date +%Y%m%d-%H%M%S)-$$.log"
  printf '\nRunning syntax checks and tests. Log: %s\n' "$LOG_FILE"
  {
    while IFS= read -r -d '' file; do node --check "$file"; done < <(git ls-files -z '*.js')
    git diff --check
    npm test
  } 2>&1 | tee "$LOG_FILE"
  printf '\nPASS. For interactive QA, run this script again with serve.\n'
  exit 0
fi
if [[ "$MODE" == serve ]]; then
  [[ -d node_modules ]] || { printf 'Run setup to install dependencies.\n' >&2; exit 1; }
  ENV_ARGS=()
  if [[ -n "$ENV_FILE" ]]; then
    [[ -f "$ENV_FILE" ]] || { printf 'Environment file not found.\n' >&2; exit 1; }
    ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd -P)/$(basename "$ENV_FILE")"
    ENV_ARGS=("--env-file=$ENV_FILE")
  fi
  mkdir -p "$DATA_DIR"
  export RAILWAY_VOLUME_MOUNT_PATH="$DATA_DIR"
  export PORT
  export FRONTEND_ORIGINS="http://localhost:$PORT,http://127.0.0.1:$PORT"
  printf '\nOpen http://localhost:%s\nQA database: %s\nStop with Ctrl-C.\n' "$PORT" "$DATA_DIR"
  printf 'Use a Clerk development/test instance for browser sign-in. Automated tests need no Clerk credentials.\n'
  node "${ENV_ARGS[@]}" -e '
    if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
      console.error("Browser sign-in needs CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY. Export them, or pass --env-file with an absolute path to your local env file.");
      process.exit(1);
    }
    const {createApp}=require("./backend/server");
    createApp().listen(Number(process.env.PORT), "127.0.0.1", () => console.log("Local QA backend ready."));
  '
fi
