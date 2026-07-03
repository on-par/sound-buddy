#!/usr/bin/env bash
# Run the full verification suite locally, mirroring .github/workflows/ci.yml
# plus the app build + Playwright e2e (which CI does not run headlessly).
#
#   ./scripts/verify.sh            # install (ci) + lint + build + unit tests + app e2e
#   ./scripts/verify.sh --fast     # skip the clean npm ci ONLY (reuse node_modules); still runs e2e
#   ./scripts/verify.sh --no-e2e   # skip the app build + Playwright e2e
#
# The two flags are independent — combine them for the quickest gate (reuse deps,
# no e2e): `./scripts/verify.sh --fast --no-e2e`. Note `--fast` assumes app deps
# are already installed; on a fresh checkout run without it (or `npm ci --prefix app`).
set -euo pipefail

cd "$(dirname "$0")/.."

FAST=0
E2E=1
for arg in "$@"; do
  case "$arg" in
    --fast)   FAST=1 ;;
    --no-e2e) E2E=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$FAST" -eq 0 ]]; then
  echo "==> npm ci (root + app)"
  npm ci
  npm ci --prefix app
fi

# Build before lint: workspaces cross-reference each other's dist/ type
# declarations, so `tsc --noEmit` only resolves after a build (CI order too).
echo "==> build (tsc, all workspaces)"
npm run build

echo "==> lint (tsc --noEmit, all workspaces + app)"
npm run lint

echo "==> test (unit, all workspaces)"
npm test

if [[ "$E2E" -eq 1 ]]; then
  echo "==> build app (tsc → dist/electron)"
  npm run build --prefix app
  echo "==> e2e (Playwright + Electron)"
  npm run test:e2e --prefix app
else
  echo "==> skipping app e2e (--no-e2e)"
fi

echo "✓ verify passed"
