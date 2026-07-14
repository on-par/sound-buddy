#!/usr/bin/env bash
# Throwaway probe for spike e9-01 (issue #155): quantify the *real* macOS floor of
# the self-contained bundle vs. the Info.plist gate users actually hit.
#
# For each Mach-O binary in a built/shipped Sound Buddy .app it prints the
# `LC_BUILD_VERSION -> minos` load command — the OS the binary was literally
# compiled to run on — and contrasts that with LSMinimumSystemVersion. The
# effective real floor is max(minos) across all bundled binaries; anything the
# Info.plist requires *above* that is an artificial gate.
#
# Usage:
#   scripts/probe-macos-floor.sh /path/to/Sound\ Buddy.app
#   scripts/probe-macos-floor.sh                # auto: newest shipped release, or a local build
#
# Requires macOS (otool, lipo, PlistBuddy). No production code depends on this.
set -euo pipefail

APP="${1:-}"

# Auto-discover a .app if none was passed: prefer a local build, else download the
# latest shipped release and inspect that (the shipped artifact is the source of truth,
# since its native tools carry the CI runner's OS floor — not this dev machine's).
TMPDIR_DL=""
cleanup() { [[ -n "$TMPDIR_DL" ]] && rm -rf "$TMPDIR_DL"; }
trap cleanup EXIT

if [[ -z "$APP" ]]; then
  for cand in app/release/mac-arm64/*.app app/release/mac/*.app; do
    [[ -d "$cand" ]] && APP="$cand" && break
  done
fi
if [[ -z "$APP" ]]; then
  echo "==> no local build found; downloading latest shipped release for inspection"
  command -v gh >/dev/null 2>&1 || { echo "gh not installed and no .app given" >&2; exit 2; }
  TMPDIR_DL="$(mktemp -d)"
  gh release download -R on-par/sound-buddy -D "$TMPDIR_DL" --pattern '*arm64-mac.zip' 2>/dev/null \
    || { echo "no downloadable release asset found; pass a .app path" >&2; exit 2; }
  ( cd "$TMPDIR_DL" && unzip -q -o ./*.zip )
  APP="$(find "$TMPDIR_DL" -maxdepth 1 -name '*.app' | head -1)"
fi

[[ -d "$APP" ]] || { echo "not a .app: $APP" >&2; exit 2; }
echo "== inspecting: $APP"

plist="$APP/Contents/Info.plist"
gate="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist" 2>/dev/null || echo '(unset)')"

max_minos=""
printf '%-40s %-8s %s\n' "BINARY" "ARCH" "minos"
printf '%-40s %-8s %s\n' "------" "----" "-----"

# Walk every Mach-O under the bundle; report each one's minos + arch.
while IFS= read -r f; do
  file "$f" 2>/dev/null | grep -q 'Mach-O' || continue
  minos="$(otool -l "$f" 2>/dev/null | awk '/LC_BUILD_VERSION/{v=1} v&&/minos/{print $2; exit}')"
  [[ -z "$minos" ]] && minos="$(otool -l "$f" 2>/dev/null | awk '/LC_VERSION_MIN_MACOSX/{v=1} v&&/version/{print $2; exit}')"
  [[ -z "$minos" ]] && continue
  arch="$(lipo -archs "$f" 2>/dev/null || echo '?')"
  printf '%-40s %-8s %s\n' "$(basename "$f")" "$arch" "$minos"
  # Track the numeric max (compare as major.minor via sort -V).
  if [[ -z "$max_minos" ]] || [[ "$(printf '%s\n%s\n' "$max_minos" "$minos" | sort -V | tail -1)" == "$minos" ]]; then
    max_minos="$minos"
  fi
done < <(find "$APP/Contents" -type f \( -name '*.dylib' -o -perm -u+x \) 2>/dev/null)

echo
echo "== Info.plist LSMinimumSystemVersion (the gate users hit): $gate"
echo "== Highest real binary floor  max(minos):                 ${max_minos:-unknown}"
echo
if [[ -n "$max_minos" && "$gate" != "(unset)" ]]; then
  if [[ "$(printf '%s\n%s\n' "$gate" "$max_minos" | sort -V | tail -1)" == "$gate" && "$gate" != "$max_minos" ]]; then
    echo "==> Info.plist requires macOS $gate but no binary needs more than $max_minos."
    echo "    The floor above $max_minos is ARTIFICIAL — inspect the packaged binary floors before raising the gate."
  else
    echo "==> Info.plist floor matches the real binary floor."
  fi
fi
