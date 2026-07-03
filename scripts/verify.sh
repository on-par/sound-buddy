#!/usr/bin/env bash
# Run the full verification suite locally, mirroring .github/workflows/ci.yml
# (install → build → lint → test) plus an Electron end-to-end smoke run that CI
# skips (it needs sox/ffprobe/python + a real Electron launch).
#
#   ./scripts/verify.sh            # full: install + build + lint + test + e2e smoke
#   ./scripts/verify.sh --no-e2e   # everything except the Electron e2e smoke
#   ./scripts/verify.sh --fast     # build + lint + test only (skip clean install + e2e)
set -euo pipefail

cd "$(dirname "$0")/.."

FAST=0
E2E=1
for arg in "$@"; do
  case "$arg" in
    --fast)   FAST=1; E2E=0 ;;
    --no-e2e) E2E=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$FAST" -eq 0 ]]; then
  echo "==> npm ci (workspaces)"
  npm ci
  echo "==> npm ci (app)"
  npm ci --prefix app
fi

echo "==> build (tsc, all workspaces)"
npm run build

echo "==> lint (workspaces + app tsc)"
npm run lint

echo "==> test (vitest, all workspaces)"
npm test

if [[ "$E2E" -eq 1 ]]; then
  # The smoke run launches the real Electron app and analyzes a fixture, so it
  # needs sox + ffprobe + python3 + installed app deps. On a box missing any of
  # them (fresh checkout, CI without media tools) skip with a warning rather than
  # failing the whole gate — build/lint/test above already passed. Use --no-e2e
  # to skip explicitly.
  missing=""
  for tool in sox ffprobe python3; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  [[ -d app/node_modules ]] || missing="$missing app-deps"
  if [[ -n "$missing" ]]; then
    echo "==> e2e smoke SKIPPED — missing:$missing (run without --no-e2e once available)"
  else
    echo "==> e2e smoke (Electron — real sox/ffprobe/python)"
    npm run build --prefix app
    ( cd app && npx playwright test tests/smoke.spec.ts )
  fi
fi

echo "✓ verify passed"
