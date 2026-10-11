#!/usr/bin/env bash
# One-command TestFlight upload for Sound Buddy iOS (#1691).
#
# Archives the SoundBuddy scheme, exports and uploads it to App Store
# Connect with the ASC API key via xcodebuild, then runs
# asc-distribute.mjs to wait for processing, fix export compliance if still
# missing, set What to Test, and add the build to every configured internal
# and external tester group (submitting beta app review once when needed).
#
# Usage:
#   apps/ios/scripts/testflight.sh [--build-number N] [--notes "..."] [--dry-run]
#
# Required env: DEVELOPMENT_TEAM, ASC_KEY_ID, ASC_ISSUER_ID, and either
# ASC_KEY_PATH (path to the .p8 private key) or ASC_KEYCHAIN_SERVICE (a
# generic-password keychain item holding the key, read via `security`).
#
# --dry-run skips the archive/export/upload and instead prints the next
# build number plus a read-only distribution plan for the latest build
# already in App Store Connect.
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") [--build-number N] [--notes \"...\"] [--dry-run]"
}

BUILD_ARG=""
NOTES_ARG=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-number)
      BUILD_ARG="$2"
      shift 2
      ;;
    --notes)
      NOTES_ARG="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

: "${DEVELOPMENT_TEAM:?error: DEVELOPMENT_TEAM is required. Set it to your Apple Developer Team ID.}"
: "${ASC_KEY_ID:?error: ASC_KEY_ID is required. Set it to your App Store Connect API key ID.}"
: "${ASC_ISSUER_ID:?error: ASC_ISSUER_ID is required. Set it to your App Store Connect API issuer ID.}"

KEY_FILE_TMP=""
cleanup() {
  if [[ -n "$KEY_FILE_TMP" ]]; then
    rm -f "$KEY_FILE_TMP"
  fi
}
trap cleanup EXIT

if [[ -z "${ASC_KEY_PATH:-}" ]]; then
  if [[ -z "${ASC_KEYCHAIN_SERVICE:-}" ]]; then
    echo "error: set ASC_KEY_PATH (path to the .p8 key) or ASC_KEYCHAIN_SERVICE (a keychain item holding it)." >&2
    exit 1
  fi
  KEY_FILE_TMP="$(mktemp)"
  chmod 600 "$KEY_FILE_TMP"
  security find-generic-password -s "$ASC_KEYCHAIN_SERVICE" -w > "$KEY_FILE_TMP"
  ASC_KEY_PATH="$KEY_FILE_TMP"
fi
export ASC_KEY_PATH

VERSION="$(xcodebuild -project "$IOS_DIR/SoundBuddy.xcodeproj" -scheme SoundBuddy -showBuildSettings -configuration Release \
  | awk '/ MARKETING_VERSION = /{print $3; exit}')"
if [[ -z "$VERSION" ]]; then
  echo "error: could not read MARKETING_VERSION from the SoundBuddy scheme." >&2
  exit 1
fi

PRINT_BUILD_ARGS=(--print-next-build-number --version "$VERSION")
if [[ -n "$BUILD_ARG" ]]; then
  PRINT_BUILD_ARGS+=(--build-number "$BUILD_ARG")
fi
BUILD="$(node "$IOS_DIR/scripts/asc-distribute.mjs" "${PRINT_BUILD_ARGS[@]}")"

DISTRIBUTE_ARGS=(--version "$VERSION" --build-number "$BUILD")
if [[ -n "$NOTES_ARG" ]]; then
  DISTRIBUTE_ARGS+=(--notes "$NOTES_ARG")
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  node "$IOS_DIR/scripts/asc-distribute.mjs" "${DISTRIBUTE_ARGS[@]}" --dry-run
  exit 0
fi

WORK="$(mktemp -d)"
trap 'cleanup; rm -rf "$WORK"' EXIT

xcodebuild archive \
  -project "$IOS_DIR/SoundBuddy.xcodeproj" \
  -scheme SoundBuddy \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$WORK/SoundBuddy.xcarchive" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  CURRENT_PROJECT_VERSION="$BUILD"

cp "$IOS_DIR/scripts/ExportOptions.plist" "$WORK/ExportOptions.plist"
plutil -replace teamID -string "$DEVELOPMENT_TEAM" "$WORK/ExportOptions.plist"

xcodebuild -exportArchive \
  -archivePath "$WORK/SoundBuddy.xcarchive" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" \
  -exportPath "$WORK/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

node "$IOS_DIR/scripts/asc-distribute.mjs" "${DISTRIBUTE_ARGS[@]}"

echo "Sound Buddy $VERSION ($BUILD) distributed."
