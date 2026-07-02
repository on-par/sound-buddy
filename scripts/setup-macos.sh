#!/usr/bin/env bash
# One-time setup for the Sound Buddy macOS app.
#
# The app shells out to three external tools that aren't bundled:
#   - sox and ffmpeg      → installed via Homebrew
#   - python + librosa…   → installed into a per-user virtualenv the app looks for
#
# Run this once after dropping "Sound Buddy.app" into /Applications. It's safe to
# re-run. The app finds the venv at:
#   ~/Library/Application Support/SoundBuddy/venv
#
# Usage:  ./scripts/setup-macos.sh
set -euo pipefail

VENV_DIR="$HOME/Library/Application Support/SoundBuddy/venv"

# Locate requirements.txt whether we're run from the repo or pointed at an app.
REPO_REQ="$(cd "$(dirname "$0")/.." && pwd)/packages/audio-engine/scripts/requirements.txt"
APP_REQ="/Applications/Sound Buddy.app/Contents/Resources/scripts/requirements.txt"
if [[ -f "$REPO_REQ" ]]; then
  REQUIREMENTS="$REPO_REQ"
elif [[ -f "$APP_REQ" ]]; then
  REQUIREMENTS="$APP_REQ"
else
  echo "error: could not find requirements.txt (looked in repo and /Applications)." >&2
  exit 1
fi

echo "==> Checking command-line tools (sox, ffmpeg)"
missing=()
command -v sox    >/dev/null 2>&1 || missing+=("sox")
command -v ffmpeg >/dev/null 2>&1 || missing+=("ffmpeg")
if [[ ${#missing[@]} -gt 0 ]]; then
  if command -v brew >/dev/null 2>&1; then
    echo "    Installing: ${missing[*]}"
    brew install "${missing[@]}"
  else
    echo "error: missing ${missing[*]} and Homebrew is not installed." >&2
    echo "       Install Homebrew from https://brew.sh then re-run this script." >&2
    exit 1
  fi
else
  echo "    ok"
fi

echo "==> Creating Python virtualenv at:"
echo "    $VENV_DIR"
python3 -m venv "$VENV_DIR"

echo "==> Installing Python dependencies (this can take a minute)"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$REQUIREMENTS"

echo "==> Verifying"
"$VENV_DIR/bin/python" -c "import librosa, soundfile, numpy, scipy; print('    python deps ok')"

echo ""
echo "Setup complete. Launch Sound Buddy from /Applications."
echo ""
echo "── Optional: AI narrative (\"AI Engineer\" panel) ─────────────────────────────"
echo "The Report Card works with no AI. To also get the prose narrative, configure a"
echo "provider in:  $HOME/Library/Application Support/SoundBuddy/llm.json"
echo ""
echo "  Offline (recommended) — local Ollama, no account:"
echo "    1. Install Ollama (https://ollama.com) and:  ollama pull llama3.2"
echo "    2. Write llm.json:   { \"provider\": \"ollama\", \"model\": \"llama3.2\" }"
echo ""
echo "  Your own subscription / API key — via the pi CLI:"
echo "    1. Install Node 22+ and:  npm i -g @earendil-works/pi-coding-agent"
echo "    2. Run  pi  then  /login  and pick ChatGPT/Codex, Claude, or Copilot"
echo "    3. Write llm.json, e.g.:  { \"provider\": \"anthropic\", \"model\": \"claude-sonnet-4-6\" }"
