#!/usr/bin/env bash
# Run the full verification suite locally, mirroring .github/workflows/ci.yml.
#
#   ./scripts/verify.sh          # install (ci) + build + test
#   ./scripts/verify.sh --fast   # build + test only (skip the clean npm ci)
set -euo pipefail

cd "$(dirname "$0")/.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

if [[ "$FAST" -eq 0 ]]; then
  echo "==> npm ci"
  npm ci
fi

echo "==> build (tsc, all workspaces)"
npm run build

echo "==> test"
npm test

echo "✓ verify passed"
