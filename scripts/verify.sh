#!/usr/bin/env bash
# Run the full verification suite locally, mirroring .github/workflows/ci.yml
# (install → build → lint → test). CI's `e2e` job (#402) now runs the same
# stubbed Playwright specs this script's e2e block runs when media tools are
# missing; this script additionally runs the full suite (real sox/ffprobe/
# python smoke specs) locally when those tools are present, which CI still
# skips.
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
  echo "==> npm ci (app/renderer)"
  npm ci --prefix app/renderer
  echo "==> npm ci (worker)"
  npm ci --prefix worker
fi

# Positioning-consistency guard (#80): the locked brand phrase must appear
# verbatim on every surface. No deps, so run it up front — fails fast on copy drift.
echo "==> positioning check (locked brand phrase)"
node scripts/check-positioning.mjs

# Secret scanning (#221): catches a real committed credential locally before
# it ever reaches CI. .gitleaks.toml allowlists known fake test-fixture
# placeholders by literal value. No deps beyond the gitleaks binary; skipped
# with a note if it isn't installed (CI always has it — see ci.yml).
# Keep this invocation in sync with the "secrets" job in ci.yml (same flags,
# same config) so local and CI results match.
if command -v gitleaks >/dev/null 2>&1; then
  echo "==> secret scan (gitleaks)"
  gitleaks detect --source . --no-git --config .gitleaks.toml --redact -v
else
  echo "==> secret scan SKIPPED — gitleaks not installed (brew install gitleaks)"
fi

# Build before lint: workspaces cross-reference each other's dist/ type
# declarations, so `tsc --noEmit` only resolves after a build (CI order too).
echo "==> build (tsc, all workspaces)"
npm run build

echo "==> lint (workspaces + app tsc)"
npm run lint

# `npm test` is the root aggregated coverage run (#438): vitest projects over
# packages/* + app + worker (skipping projects whose deps aren't installed),
# writing one merged report (incl. Cobertura XML) to ./coverage. Its
# coverage:deps preflight best-effort-installs the app/worker roots, so on a
# --fast run with a clean tree this step may install them anyway.
echo "==> test (unit, aggregated coverage — packages + app + worker)"
npm test

# The Electron app is not an npm workspace, so its Vitest suite (settings, IPC
# helpers) runs separately. Needs app deps; skipped with a note when absent.
if [[ -d app/node_modules ]]; then
  echo "==> test (unit, app)"
  npm test --prefix app
else
  echo "==> app unit tests SKIPPED — app deps not installed (run without --fast, or: npm ci --prefix app)"
fi

# Python analysis helpers (stream.py, playback.py). Require numpy + scipy;
# sounddevice is stubbed by their tests. Skipped with a note if no suitable
# interpreter is found.
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

# spike helpers (spike_dual_capture.py, spike_waveform_transport.py) are
# plain Python (no numpy/scipy — the modules keep both out of their analysis
# helpers so these run on any python3), so they're gated on interpreter
# presence only — independent of the numpy+scipy probe above, which would
# otherwise skip these tests on a host that lacks numpy/scipy but has a
# perfectly good plain python3.
PYTHON_PLAIN="${SOUND_BUDDY_PYTHON:-}"
if [[ -z "$PYTHON_PLAIN" ]]; then
  for cand in ./.venv/bin/python3 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
      PYTHON_PLAIN="$cand"; break
    fi
  done
fi
if [[ -n "$PYTHON_PLAIN" ]]; then
  echo "==> python tests (spike_dual_capture.py) via $PYTHON_PLAIN"
  "$PYTHON_PLAIN" packages/audio-engine/scripts/test_spike_dual_capture.py
  echo "==> python tests (spike_waveform_transport.py) via $PYTHON_PLAIN"
  "$PYTHON_PLAIN" packages/audio-engine/scripts/test_spike_waveform_transport.py
else
  echo "==> python tests (spike_dual_capture.py, spike_waveform_transport.py) skipped (no python3 interpreter found)"
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
  if [[ ! -d app/node_modules || ! -d app/renderer/node_modules ]]; then
    echo "==> e2e SKIPPED — app deps not installed (run without --fast, or: npm ci --prefix app && npm ci --prefix app/renderer)"
  else
    echo "==> build app (renderer vite build + tsc → dist/electron)"
    npm run build --prefix app
    missing=""
    for tool in sox ffprobe python3; do
      command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
    done
    if [[ -n "$missing" ]]; then
      echo "==> e2e: smoke SKIPPED (missing:$missing) — running stubbed specs only"
      # SB_E2E_STUBBED_ONLY (playwright.config.ts MEDIA_SPECS) excludes the
      # specs that need real sox/ffprobe/python (smoke/packaged/packaged-
      # onboarding/onboarding); this is the same set CI's e2e job runs (#402).
      npm run test:e2e:stubbed --prefix app
    else
      echo "==> e2e (full Playwright suite — real sox/ffprobe/python)"
      npm run test:e2e --prefix app
    fi
  fi
else
  echo "==> skipping app e2e (--no-e2e / --fast)"
fi

echo "✓ verify passed"
