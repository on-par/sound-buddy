#!/usr/bin/env bash
# Run SoundBuddyKit's tests on a Mac: `swift test` in apps/ios/SoundBuddyKit.
#
# With full Xcode selected (and its license accepted) plain `swift test` just
# works. With only the Command Line Tools usable, swift-testing's framework is
# on disk but not on the default search path, so pass it explicitly. This is
# macOS-only: SoundBuddyKit imports Accelerate, and Linux CI never runs it.
set -euo pipefail
cd "$(dirname "$0")/../SoundBuddyKit"

if xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1; then
  # xcrun, not bare `swift`: PATH may hold an older Command Line Tools swift
  # that cannot build against the selected Xcode's SDK.
  exec xcrun swift test "$@"
fi

CLT=/Library/Developer/CommandLineTools
if [[ ! -d "$CLT" ]]; then
  echo "error: no usable Xcode or Command Line Tools. Install Xcode (and run 'sudo xcodebuild -license accept') or 'xcode-select --install'." >&2
  exit 1
fi
echo "note: Xcode unusable (license not accepted?) — running with Command Line Tools." >&2
FW="$CLT/Library/Developer/Frameworks"
LIB="$CLT/Library/Developer/usr/lib"
DEVELOPER_DIR="$CLT" exec swift test \
  -Xswiftc -F"$FW" \
  -Xlinker -F"$FW" -Xlinker -rpath -Xlinker "$FW" -Xlinker -rpath -Xlinker "$LIB" \
  "$@"
