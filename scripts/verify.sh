#!/usr/bin/env bash
# Run the full verification suite locally, mirroring .github/workflows/ci.yml
# (install → build → lint → test) plus the Electron end-to-end suite that CI
# skips (it needs a real Electron launch, and the smoke run needs sox/ffprobe/python).
#
#   ./scripts/verify.sh            # full: install + build + lint + test + app e2e
#   ./scripts/verify.sh --no-e2e   # everything except the Electron e2e
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
  echo "==> npm ci (worker)"
  npm ci --prefix worker
fi

# Positioning-consistency guard (#80): the locked brand phrase must appear
# verbatim on every surface. No deps, so run it up front — fails fast on copy drift.
echo "==> positioning check (locked brand phrase)"
node scripts/check-positioning.mjs

# Build before lint: workspaces cross-reference each other's dist/ type
# declarations, so `tsc --noEmit` only resolves after a build (CI order too).
echo "==> build (tsc, all workspaces)"
npm run build

echo "==> lint (workspaces + app tsc)"
npm run lint

echo "==> test (unit, all workspaces)"
npm test

# The Electron app is not an npm workspace, so its Vitest suite (settings, IPC
# helpers) runs separately. Needs app deps; skipped with a note when absent.
if [[ -d app/node_modules ]]; then
  echo "==> test (unit, app)"
  npm test --prefix app
else
  echo "==> app unit tests SKIPPED — app deps not installed (run without --fast, or: npm ci --prefix app)"
fi

# Python analysis helpers (stream.py). Requires numpy + scipy; sounddevice is
# stubbed by the test. Skipped with a note if no suitable interpreter is found.
PYTHON="${SOUND_BUDDY_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  for cand in ./.venv/bin/python3 python3; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import numpy, scipy' >/dev/null 2>&1; then
      PYTHON="$cand"; break
    fi
  done
fi
if [[ -n "$PYTHON" ]]; then
  echo "==> python tests (stream.py) via $PYTHON"
  "$PYTHON" packages/audio-engine/scripts/test_stream.py
  echo "==> python tests (playback.py) via $PYTHON"
  "$PYTHON" packages/audio-engine/scripts/test_playback.py
else
  echo "==> python tests skipped (no interpreter with numpy+scipy)"
fi

# The Stripe / licensing API Worker (worker/, #107) is a standalone package like
# site/ — not an npm workspace. It verifies independently (typecheck + vitest).
# Skipped with a note if its deps aren't installed (e.g. a --fast run).
if [[ -d worker/node_modules ]]; then
  echo "==> verify (worker: typecheck + tests)"
  npm run verify --prefix worker
  echo "==> test coverage (worker, gated)"
  npm run test:coverage --prefix worker
else
  echo "==> worker verify SKIPPED — deps not installed (cd worker && npm ci)"
fi

if [[ "$E2E" -eq 1 ]]; then
  # The e2e suite launches the real Electron app. The smoke spec additionally
  # analyzes a fixture through sox + ffprobe + python3; when those are missing
  # (fresh box, CI without media tools) run only the stubbed specs rather than
  # failing the gate. App deps are required to build dist/electron at all.
  if [[ ! -d app/node_modules ]]; then
    echo "==> e2e SKIPPED — app deps not installed (run without --fast, or: npm ci --prefix app)"
  else
    echo "==> build app (tsc → dist/electron)"
    npm run build --prefix app
    missing=""
    for tool in sox ffprobe python3; do
      command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
    done
    if [[ -n "$missing" ]]; then
      echo "==> e2e: smoke SKIPPED (missing:$missing) — running stubbed specs only"
      ( cd app && npx playwright test tests/e2e.spec.ts )
    else
      echo "==> e2e (full Playwright suite — real sox/ffprobe/python)"
      npm run test:e2e --prefix app
    fi
  fi
else
  echo "==> skipping app e2e (--no-e2e / --fast)"
fi

echo "✓ verify passed"
