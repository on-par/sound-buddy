#!/usr/bin/env bash
#
# Publish a new self-contained macOS release of Sound Buddy to the PUBLIC
# download repo (on-par/sound-buddy-releases).
#
# No stored tokens, no CI secret — it uses your local `gh` auth. It bumps the
# version, builds the self-contained .app, tags the source repo, and publishes
# the zip to the public repo.
#
# Usage:
#   scripts/release.sh              # patch bump  (0.2.1 -> 0.2.2)
#   scripts/release.sh minor        # minor bump  (0.2.1 -> 0.3.0)
#   scripts/release.sh major        # major bump  (0.2.1 -> 1.0.0)
#   scripts/release.sh 0.5.0        # explicit version
#   scripts/release.sh patch --dry-run   # do everything except mutate/publish
#   scripts/release.sh --yes        # skip the confirmation prompt
#
set -euo pipefail

PUBLIC_REPO="on-par/sound-buddy-releases"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"

# ── Args ─────────────────────────────────────────────────────────────────────
BUMP="patch"
DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg" ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
say "Checking prerequisites"
for tool in gh node npm git sox ffmpeg ffprobe dylibbundler curl; do
  command -v "$tool" >/dev/null 2>&1 || die "missing '$tool'. Build tools: brew install sox ffmpeg dylibbundler"
done
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub — run: gh auth login"
gh repo view "$PUBLIC_REPO" >/dev/null 2>&1 || die "can't reach $PUBLIC_REPO (permissions?)"

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  die "working tree is dirty — commit or stash first (a release should be a clean bump)"
fi

CURRENT="$(node -p "require('$APP/package.json').version")"
# Compute the next version with pure semver math — writes nothing.
NEXT="$(node -e '
  const cur = require(process.argv[1]).version;
  const bump = process.argv[2];
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(bump)) { console.log(bump); process.exit(0); }
  let [a, b, c] = cur.split(".").map(Number);
  if (bump === "major") { a++; b = 0; c = 0; }
  else if (bump === "minor") { b++; c = 0; }
  else { c++; }
  console.log(`${a}.${b}.${c}`);
' "$APP/package.json" "$BUMP")"
TAG="v$NEXT"

say "Current version : $CURRENT"
say "New version     : $NEXT   (tag $TAG)"
say "Publishes to    : https://github.com/$PUBLIC_REPO/releases/tag/$TAG"

if gh release view "$TAG" -R "$PUBLIC_REPO" >/dev/null 2>&1; then
  die "release $TAG already exists on $PUBLIC_REPO"
fi

# ── Quality gate ─────────────────────────────────────────────────────────────
say "Running gate (build, lint, test)"
( cd "$ROOT" && npm run build >/dev/null && npm run lint >/dev/null && npm test >/dev/null ) \
  || die "gate failed — fix build/lint/test before releasing"
say "Gate passed"

if [[ "$DRY_RUN" == 1 ]]; then
  say "Dry run — stopping before version bump / build / publish."
  exit 0
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  printf '\033[1;33mRelease %s to %s? [y/N] \033[0m' "$TAG" "$PUBLIC_REPO"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
fi

# ── Bump, build, verify ──────────────────────────────────────────────────────
say "Bumping version to $NEXT"
( cd "$APP" && npm version "$NEXT" --no-git-tag-version --allow-same-version >/dev/null )
# npm version touches package.json (and package-lock.json if present).

say "Building self-contained app (this takes a minute)"
( cd "$APP" && npm run dist >/dev/null )

ZIP="$APP/release/Sound Buddy-$NEXT-arm64-mac.zip"
[[ -f "$ZIP" ]] || die "expected zip not found: $ZIP"
# Sanity: the bundle must actually be self-contained.
APP_RES="$APP/release/mac-arm64/Sound Buddy.app/Contents/Resources"
[[ -x "$APP_RES/bin/sox" && -x "$APP_RES/python/bin/python3" ]] || die "bundle is missing sox/python — build problem"
say "Built $(basename "$ZIP") ($(du -h "$ZIP" | cut -f1))"

# ── Tag the source repo ──────────────────────────────────────────────────────
say "Committing + tagging the source repo"
git -C "$ROOT" add "$APP/package.json" "$APP/package-lock.json"
git -C "$ROOT" commit -q -m "release: $TAG"
git -C "$ROOT" tag "$TAG"
git -C "$ROOT" push -q origin HEAD
git -C "$ROOT" push -q origin "$TAG"

# ── Publish to the public download repo ──────────────────────────────────────
say "Publishing to $PUBLIC_REPO"

# Signed iff app/electron-builder.yml sets a real Developer ID `identity` (not
# `null`/missing) — see #53. Reading it here (rather than hardcoding) means the
# release notes' unsigned-workaround block disappears automatically the day
# signing ships, with no further edits to this script.
IDENTITY="$(node -e '
  const y = require("fs").readFileSync(process.argv[1], "utf8");
  const m = y.match(/^\s*identity:\s*(.+?)\s*$/m);
  const v = (m ? m[1] : "null").replace(/\s+#.*$/, "");
  console.log(v || "null");
' "$APP/electron-builder.yml")"
SIGNED=$([ "$IDENTITY" = "null" ] && echo false || echo true)
say "Release notes: $([ "$SIGNED" = "true" ] && echo "signed" || echo "unsigned") build"

HIGHLIGHTS=""
# The leading HTML comment is an editor-only instruction — strip it so it
# never ships as literal text in the published release notes (GitHub hides
# HTML comments in rendered markdown, but `gh release view`/the API/RSS show
# raw markdown as-is).
[[ -f "$ROOT/RELEASE_HIGHLIGHTS.md" ]] && HIGHLIGHTS="$(sed -E '/^<!--.*-->[[:space:]]*$/d' "$ROOT/RELEASE_HIGHLIGHTS.md")"

NOTES="$(node --input-type=module -e '
  import { buildReleaseNotes } from "'"$ROOT"'/packages/shared/dist/index.js";
  process.stdout.write(buildReleaseNotes({
    version: process.argv[1],
    signed: process.argv[2] === "true",
    highlights: process.argv[3] || undefined,
  }));
' "$NEXT" "$SIGNED" "$HIGHLIGHTS")"
gh release create "$TAG" "$ZIP" -R "$PUBLIC_REPO" \
  --title "Sound Buddy $TAG (macOS Apple Silicon)" \
  --notes "$NOTES"

# ── Publish the machine-readable latest-release manifest (#500) ─────────────
say "Generating latest.json manifest"
ASSET_NAME="Sound.Buddy-$NEXT-arm64-mac.zip"
ZIP_SIZE="$(stat -f%z "$ZIP")"
ZIP_SHA256="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MANIFEST_PATH="$APP/release/latest.json"
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { buildReleaseManifest } from "'"$ROOT"'/packages/shared/dist/index.js";
  const [version, notes, releaseUrl, artifactUrl, size, sha256, publishedAt, out] = process.argv.slice(1);
  const manifest = buildReleaseManifest({
    version, notes, releaseUrl, artifactUrl,
    artifactSizeBytes: Number(size), sha256, publishedAt,
  });
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
' "$NEXT" "$NOTES" \
  "https://github.com/$PUBLIC_REPO/releases/tag/$TAG" \
  "https://github.com/$PUBLIC_REPO/releases/download/$TAG/$ASSET_NAME" \
  "$ZIP_SIZE" "$ZIP_SHA256" "$PUBLISHED_AT" "$MANIFEST_PATH" \
  || die "manifest generation failed — see error above"
gh release upload "$TAG" "$MANIFEST_PATH" -R "$PUBLIC_REPO" \
  || die "manifest upload failed — run: gh release upload $TAG $MANIFEST_PATH -R $PUBLIC_REPO"
say "Manifest → https://github.com/$PUBLIC_REPO/releases/latest/download/latest.json"

say "Done → https://github.com/$PUBLIC_REPO/releases/tag/$TAG"
