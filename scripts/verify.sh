#!/usr/bin/env bash
# Run the full verification suite locally, mirroring .github/workflows/ci.yml
# (plus the Electron app build, which CI does not currently typecheck).
#
#   ./scripts/verify.sh            # install (ci) + build + lint + test + app build
#   ./scripts/verify.sh --fast     # skip the clean npm ci (reuse node_modules)
#   ./scripts/verify.sh --e2e      # also run the Playwright/Electron e2e suite
#
# --no-e2e is the default (e2e needs a built app + display and is opt-in), so the
# fast path here is "no e2e" — pass --e2e to include it.
set -euo pipefail

cd "$(dirname "$0")/.."

FAST=0
E2E=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --e2e) E2E=1 ;;
    --no-e2e) E2E=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$FAST" -eq 0 ]]; then
  echo "==> npm ci (root + app)"
  npm ci
  npm ci --prefix app
fi

echo "==> build (tsc, all workspaces)"
npm run build

echo "==> lint (packages + app)"
npm run lint

echo "==> test (workspaces)"
npm test

echo "==> build app (electron tsc)"
npm run build --prefix app

if [[ "$E2E" -eq 1 ]]; then
  echo "==> e2e (playwright/electron)"
  npm run test:e2e --prefix app
fi

echo "✓ verify passed"
