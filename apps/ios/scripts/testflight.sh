#!/usr/bin/env bash
# One-command TestFlight upload for Sound Buddy iOS (#1691, #1696).
#
# Archives the SoundBuddy scheme with MANUAL signing (the existing App Store
# distribution profile and identity from testflight.config.json, with the
# build keychain passed to codesign via --keychain), exports and uploads it
# to App Store Connect with the ASC API key via xcodebuild, then runs
# asc-distribute.mjs to wait for processing, fix export compliance if still
# missing, set What to Test, and add the build to every configured internal
# and external tester group (submitting beta app review once when needed).
#
# It never creates certificates or provisioning profiles: Xcode's automatic
# provisioning updates and automatic signing are only used with the explicit
# --allow-provisioning-updates opt-in.
#
# Usage:
#   apps/ios/scripts/testflight.sh [--build-number N] [--notes "..."] [--dry-run]
#       [--no-upload] [--team ID] [--profile NAME] [--identity NAME]
#       [--keychain PATH] [--allow-provisioning-updates]
#
# Required env for an upload: ASC_KEY_ID, ASC_ISSUER_ID, and either
# ASC_KEY_PATH (path to the .p8 private key) or ASC_KEYCHAIN_SERVICE (a
# generic-password keychain item holding the key, read via `security`).
# Optional env: DEVELOPMENT_TEAM and TESTFLIGHT_SIGNING_KEYCHAIN override the
# team and keychain from testflight.config.json.
#
# --dry-run prints the signing plan and the archive/export commands without
# running them, then (when the ASC env is set) the next build number and a
# read-only distribution plan for the latest build in App Store Connect.
# --no-upload archives and exports an .ipa locally and skips the upload and
# distribution (needs --build-number unless the ASC env is set).
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: testflight.sh [--build-number N] [--notes "..."] [--dry-run] [--no-upload]
                     [--team ID] [--profile NAME] [--identity NAME] [--keychain PATH]
                     [--allow-provisioning-updates]
USAGE
}

need_value() {
  if [[ $# -lt 2 || -z "$2" ]]; then
    echo "error: $1 needs a value" >&2
    exit 1
  fi
}

BUILD_ARG=""
NOTES_ARG=""
DRY_RUN=0
NO_UPLOAD=0
SIGNING_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-number) need_value "$@"; BUILD_ARG="$2"; shift 2 ;;
    --notes) need_value "$@"; NOTES_ARG="$2"; shift 2 ;;
    --team|--profile|--identity|--keychain) need_value "$@"; SIGNING_ARGS+=("$1" "$2"); shift 2 ;;
    --allow-provisioning-updates) SIGNING_ARGS+=("$1"); shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-upload) NO_UPLOAD=1; SIGNING_ARGS+=("$1"); shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown argument $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIGNING=(python3 "$IOS_DIR/scripts/testflight_signing.py")

# Fails fast (exit 2) on a missing or malformed signing config.
"${SIGNING[@]}" plan "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}" > /dev/null

has_asc_env() {
  [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" && ( -n "${ASC_KEY_PATH:-}" || -n "${ASC_KEYCHAIN_SERVICE:-}" ) ]]
}

KEY_FILE_TMP=""
WORK=""
cleanup() {
  if [[ -n "$KEY_FILE_TMP" ]]; then
    rm -f "$KEY_FILE_TMP"
  fi
  if [[ -n "$WORK" ]]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

load_asc_key() {
  if [[ -z "${ASC_KEY_PATH:-}" ]]; then
    KEY_FILE_TMP="$(mktemp)"
    chmod 600 "$KEY_FILE_TMP"
    security find-generic-password -s "$ASC_KEYCHAIN_SERVICE" -w > "$KEY_FILE_TMP"
    ASC_KEY_PATH="$KEY_FILE_TMP"
  fi
  export ASC_KEY_PATH
}

read_version() {
  xcodebuild -project "$IOS_DIR/SoundBuddy.xcodeproj" -scheme SoundBuddy -showBuildSettings -configuration Release \
    -destination 'generic/platform=iOS' 2>/dev/null \
    | awk '/ MARKETING_VERSION = /{print $3; exit}'
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  "${SIGNING[@]}" dry-run "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}" --build-number "${BUILD_ARG:-<next>}"
  echo ""
  "${SIGNING[@]}" preflight "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}" || true
  if [[ "$NO_UPLOAD" -eq 1 ]]; then
    exit 0
  fi
  if ! has_asc_env; then
    echo ""
    echo "Distribution plan skipped: ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (or ASC_KEYCHAIN_SERVICE) are not all set."
    exit 0
  fi
  load_asc_key
  VERSION="$(read_version)"
  PRINT_BUILD_ARGS=(--print-next-build-number --version "$VERSION")
  if [[ -n "$BUILD_ARG" ]]; then
    PRINT_BUILD_ARGS+=(--build-number "$BUILD_ARG")
  fi
  BUILD="$(node "$IOS_DIR/scripts/asc-distribute.mjs" "${PRINT_BUILD_ARGS[@]}")"
  echo ""
  echo "Next build: $VERSION ($BUILD)"
  DISTRIBUTE_ARGS=(--version "$VERSION" --build-number "$BUILD")
  if [[ -n "$NOTES_ARG" ]]; then
    DISTRIBUTE_ARGS+=(--notes "$NOTES_ARG")
  fi
  node "$IOS_DIR/scripts/asc-distribute.mjs" "${DISTRIBUTE_ARGS[@]}" --dry-run
  exit 0
fi

if [[ "$NO_UPLOAD" -eq 0 ]] && ! has_asc_env; then
  echo "error: set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (path to the .p8 key) or ASC_KEYCHAIN_SERVICE (a keychain item holding it)." >&2
  exit 1
fi

# Refuses to start when the identity is not in the build keychain.
"${SIGNING[@]}" preflight "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}"

VERSION="$(read_version)"
if [[ -z "$VERSION" ]]; then
  echo "error: could not read MARKETING_VERSION from the SoundBuddy scheme." >&2
  exit 1
fi

if has_asc_env; then
  load_asc_key
  PRINT_BUILD_ARGS=(--print-next-build-number --version "$VERSION")
  if [[ -n "$BUILD_ARG" ]]; then
    PRINT_BUILD_ARGS+=(--build-number "$BUILD_ARG")
  fi
  BUILD="$(node "$IOS_DIR/scripts/asc-distribute.mjs" "${PRINT_BUILD_ARGS[@]}")"
elif [[ -n "$BUILD_ARG" ]]; then
  BUILD="$BUILD_ARG"
else
  echo "error: --no-upload without the ASC env needs --build-number N." >&2
  exit 1
fi

WORK="$(mktemp -d)"
PATHS=(
  --archive-path "$WORK/SoundBuddy.xcarchive"
  --export-options-path "$WORK/ExportOptions.plist"
  --export-path "$WORK/export"
  --build-number "$BUILD"
)

# The helper prints NUL-delimited argv so names with spaces (the profile and
# identity) survive intact. Bash 3.2 compatible (no mapfile).
read_args() {
  local arg
  ARGS=()
  while IFS= read -r -d '' arg; do
    ARGS+=("$arg")
  done < <("${SIGNING[@]}" "$@")
}

"${SIGNING[@]}" plan "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}"

read_args archive-args "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}" "${PATHS[@]}"
xcodebuild "${ARGS[@]}"

"${SIGNING[@]}" export-options "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}" "${PATHS[@]}" --out "$WORK/ExportOptions.plist"
read_args export-args "${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}" "${PATHS[@]}"
xcodebuild "${ARGS[@]}"

if [[ "$NO_UPLOAD" -eq 1 ]]; then
  OUT="${TMPDIR:-/tmp}/soundbuddy-testflight-export"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -R "$WORK/export/." "$OUT/"
  echo "Sound Buddy $VERSION ($BUILD) exported to $OUT (not uploaded)."
  exit 0
fi

DISTRIBUTE_ARGS=(--version "$VERSION" --build-number "$BUILD")
if [[ -n "$NOTES_ARG" ]]; then
  DISTRIBUTE_ARGS+=(--notes "$NOTES_ARG")
fi
node "$IOS_DIR/scripts/asc-distribute.mjs" "${DISTRIBUTE_ARGS[@]}"

echo "Sound Buddy $VERSION ($BUILD) distributed."
