#!/usr/bin/env bash
#
# Cut a new Sound Buddy release by pushing a tag. `.github/workflows/release.yml`
# is the only thing that builds, signs, notarizes, verifies the update feed, and
# publishes to the public download repo (on-par/sound-buddy-releases) — it stages
# a draft it promotes last (ADR-0095). This script builds nothing and uploads
# nothing.
#
# It runs preflight and the local quality gate, bumps the version, previews the
# release notes, commits/tags/pushes, then blocks on the tagged CI run and
# verifies what CI published.
#
# Usage:
#   scripts/release.sh              # patch bump  (0.2.1 -> 0.2.2)
#   scripts/release.sh minor        # minor bump  (0.2.1 -> 0.3.0)
#   scripts/release.sh major        # major bump  (0.2.1 -> 1.0.0)
#   scripts/release.sh 0.5.0        # explicit version (also how you resume a failed run)
#   scripts/release.sh patch --dry-run   # preflight + gate only, no tag, no changes
#   scripts/release.sh --yes        # skip the confirmation prompt
#
# See docs/signing-and-notarization.md § CI for how the workflow signs and
# notarizes the build.
#
set -euo pipefail

PUBLIC_REPO="on-par/sound-buddy-releases"
SOURCE_REPO="on-par/sound-buddy"
RELEASE_WORKFLOW="release.yml"
RUN_LOOKUP_ATTEMPTS=40          # 40 × 15s = 10 minutes for the tag push to register a run
RUN_LOOKUP_INTERVAL_SECS=15
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"

# ── Args ─────────────────────────────────────────────────────────────────────
BUMP="patch"
DRY_RUN=0
ASSUME_YES=0
EXPLICIT_VERSION=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg"; EXPLICIT_VERSION=1 ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
say "Checking prerequisites"
for tool in gh node npm git; do
  command -v "$tool" >/dev/null 2>&1 || die "missing '$tool'"
done
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub — run: gh auth login"
gh repo view "$PUBLIC_REPO" >/dev/null 2>&1 || die "can't reach $PUBLIC_REPO (permissions?)"

# The preflight checks below (classifyWorkingTree, evaluateReleasePreflight) need
# packages/shared/dist before the full Quality gate (which builds everything)
# runs — build just this package now so a fresh checkout doesn't crash with a
# raw ERR_MODULE_NOT_FOUND before ever reaching the gate that would build it.
( cd "$ROOT" && npm run build -w @sound-buddy/shared >/dev/null ) \
  || die "failed to build packages/shared — required before preflight checks can run"

PORCELAIN="$(git -C "$ROOT" status --porcelain)"
TREE_STATE="$(node --input-type=module -e '
  import { classifyWorkingTree } from "'"$ROOT"'/packages/shared/dist/index.js";
  process.stdout.write(classifyWorkingTree(process.argv[1]));
' "$PORCELAIN")"
case "$TREE_STATE" in
  clean) ;;
  version-bump-only)
    # A prior run bumped app/package.json but never got to commit/tag/push it.
    # Target that exact stranded version instead of re-running the bump math on
    # top of it — otherwise a bare re-run (no explicit version) would silently
    # skip the stranded version and cut the next one instead.
    BUMPED_VERSION="$(node -p "require('$APP/package.json').version")"
    say "working tree has only the version bump from a prior partial run (already at $BUMPED_VERSION) — resuming that exact version"
    BUMP="$BUMPED_VERSION"
    EXPLICIT_VERSION=1
    ;;
  dirty) die "working tree is dirty — commit or stash first (a release should be a clean bump)" ;;
esac

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
ZIP_ASSET_NAME="Sound.Buddy-$NEXT-arm64-mac.zip"
DMG_ASSET_NAME="Sound.Buddy-$NEXT-arm64.dmg"
RELEASE_URL="https://github.com/$PUBLIC_REPO/releases/tag/$TAG"
ARTIFACT_URL="https://github.com/$PUBLIC_REPO/releases/download/$TAG/$ZIP_ASSET_NAME"

say "Current version : $CURRENT"
say "New version     : $NEXT   (tag $TAG)"
say "Publishes to    : $RELEASE_URL"

# Build the frozen PublishTargets JSON once — reused by preflight, the
# --dry-run plan preview, and the tag-and-wait phase.
targets_json() {
  node -e '
    const [version, tag, zipAssetName, dmgAssetName] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ version, tag, zipAssetName, dmgAssetName }));
  ' "$NEXT" "$TAG" "$ZIP_ASSET_NAME" "$DMG_ASSET_NAME"
}
TARGETS_JSON="$(targets_json)"

# HEAD's committed app/package.json version, or empty if unreadable/unparsable.
head_committed_version() {
  git -C "$ROOT" show "HEAD:app/package.json" 2>/dev/null \
    | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version' 2>/dev/null || true
}

# Observe what already exists on $PUBLIC_REPO/$TAG (the tag or release may
# already exist from an earlier, partially-completed run). A draft release is
# untagged on GitHub until it's published (#645), so a tag-based release
# lookup 404s for a stranded draft — list releases instead and match by
# tag_name, which drafts do carry. per_page=100 is far above this repo's
# release count; no pagination needed.
gather_publish_state() {
  local release_json
  release_json="$(gh api "repos/$PUBLIC_REPO/releases?per_page=100" 2>/dev/null || true)"

  local tag_local=false tag_origin=false version_committed=false
  git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 && tag_local=true
  git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 && tag_origin=true
  local head_version
  head_version="$(head_committed_version)"
  [[ "$head_version" == "$NEXT" ]] && version_committed=true

  node --input-type=module -e '
    import { selectReleaseByTag } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [releaseJson, tagLocal, tagOrigin, versionCommitted, tag] = process.argv.slice(1);
    let release = null;
    let assetNames = [];
    const trimmed = releaseJson.trim();
    if (trimmed) {
      const selected = selectReleaseByTag(JSON.parse(trimmed), tag);
      if (selected) {
        release = { id: selected.id, isDraft: selected.isDraft };
        assetNames = selected.assetNames;
      }
    }
    process.stdout.write(JSON.stringify({
      tagExistsLocally: tagLocal === "true",
      tagExistsOnOrigin: tagOrigin === "true",
      versionCommitted: versionCommitted === "true",
      release,
      assetNames,
    }));
  ' "$release_json" "$tag_local" "$tag_origin" "$version_committed" "$TAG"
}

STATE_JSON="$(gather_publish_state)"
PREFLIGHT_JSON="$(node --input-type=module -e '
  import { evaluateReleasePreflight } from "'"$ROOT"'/packages/shared/dist/index.js";
  const [stateJson, targetsJson, explicitVersion] = process.argv.slice(1);
  const verdict = evaluateReleasePreflight(JSON.parse(stateJson), JSON.parse(targetsJson), explicitVersion === "1");
  process.stdout.write(JSON.stringify(verdict));
' "$STATE_JSON" "$TARGETS_JSON" "$EXPLICIT_VERSION")"

if [[ "$(node -pe 'JSON.parse(process.argv[1]).ok' "$PREFLIGHT_JSON")" != "true" ]]; then
  die "$(node -pe 'JSON.parse(process.argv[1]).error' "$PREFLIGHT_JSON")"
fi
say "$(node -pe 'JSON.parse(process.argv[1]).notice' "$PREFLIGHT_JSON")"

# ── Quality gate ─────────────────────────────────────────────────────────────
say "Running gate (build, lint, test)"
( cd "$ROOT" && npm run build >/dev/null && npm run lint >/dev/null && npm test >/dev/null ) \
  || die "gate failed — fix build/lint/test before releasing"
say "Gate passed"

HIGHLIGHTS=""
# The leading HTML comment is an editor-only instruction — strip it so it
# never ships as literal text in the published release notes (GitHub hides
# HTML comments in rendered markdown, but the REST API and RSS feed show
# raw markdown as-is).
[[ -f "$ROOT/RELEASE_HIGHLIGHTS.md" ]] && HIGHLIGHTS="$(sed -E '/^<!--.*-->[[:space:]]*$/d' "$ROOT/RELEASE_HIGHLIGHTS.md")"

# Before cutting a release, also edit app/assets/whats-new.md (#271) — its
# bullets become the in-app "what's new" note shown once after users update.
# Leave it empty / delete it for a build with nothing to announce. It ships
# automatically via electron-builder's `assets` extraResources mapping, so no
# script logic here needs to change.
#
# Both RELEASE_HIGHLIGHTS.md and app/assets/whats-new.md must be committed
# before the tag is pushed — CI reads them from the tagged checkout, not from
# the working tree this script runs in.

# CI always signs (scripts/ci-release-manifest.mjs passes signed: true for the
# published manifest) — this is a notes preview only; nothing here passes it to
# a build or a release.
NOTES="$(node --input-type=module -e '
  import { buildReleaseNotes } from "'"$ROOT"'/packages/shared/dist/index.js";
  process.stdout.write(buildReleaseNotes({
    version: process.argv[1],
    signed: true,
    highlights: process.argv[2] || undefined,
  }));
' "$NEXT" "$HIGHLIGHTS")"

if [[ "$DRY_RUN" == 1 ]]; then
  say "Dry run — manifest that CI would publish as latest.json:"
  node --input-type=module -e '
    import { buildReleaseManifestPreview, RELEASE_MANIFEST_URL } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [version, notes, releaseUrl, artifactUrl] = process.argv.slice(1);
    const preview = buildReleaseManifestPreview({
      version, notes, releaseUrl, artifactUrl, signed: true,
    });
    console.log(JSON.stringify(preview, null, 2));
    console.log(`\nStable download URL: ${RELEASE_MANIFEST_URL}`);
  ' "$NEXT" "$NOTES" "$RELEASE_URL" "$ARTIFACT_URL" \
    || die "manifest preview failed — see error above"

  say "Dry run — latest-mac.yml and latest.json are generated and uploaded by .github/workflows/release.yml; this script uploads nothing."

  say "Dry run — publish plan for the observed state (what a real run would do):"
  node --input-type=module -e '
    import { planReleasePublish } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [stateJson, targetsJson] = process.argv.slice(1);
    const plan = planReleasePublish(JSON.parse(stateJson), JSON.parse(targetsJson));
    if (!plan.ok) { console.error(plan.error); process.exit(1); }
    for (const s of plan.steps) console.log(`  [${s.action}] ${s.step} — ${s.reason}`);
  ' "$STATE_JSON" "$TARGETS_JSON" \
    || die "publish plan preview failed — see error above"

  say "Dry run — stopping before version bump / tag push."
  exit 0
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  printf '\033[1;33mRelease %s to %s? [y/N] \033[0m' "$TAG" "$PUBLIC_REPO"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
fi

# The tag/release may already exist from an earlier, partially-completed
# attempt at this same version — re-observe state right before acting.
STATE_JSON="$(gather_publish_state)"
PLAN_JSON="$(node --input-type=module -e '
  import { planReleasePublish } from "'"$ROOT"'/packages/shared/dist/index.js";
  const [stateJson, targetsJson] = process.argv.slice(1);
  const plan = planReleasePublish(JSON.parse(stateJson), JSON.parse(targetsJson));
  process.stdout.write(JSON.stringify(plan));
' "$STATE_JSON" "$TARGETS_JSON")"

step_action() {
  node -pe 'JSON.parse(process.argv[1]).steps.find((s) => s.step === process.argv[2]).action' "$PLAN_JSON" "$1"
}
step_reason() {
  node -pe 'JSON.parse(process.argv[1]).steps.find((s) => s.step === process.argv[2]).reason' "$PLAN_JSON" "$1"
}
for step in tag-push ci-build verify-published; do
  say "  [$(step_action "$step")] $step — $(step_reason "$step")"
done

TAG_PUSH_ACTION="$(step_action tag-push)"
CI_BUILD_ACTION="$(step_action ci-build)"

to_json_array() {
  node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$@"
}

COMPLETED=()
SKIPPED=()

publish_fail() {
  local step="$1" detail="$2"
  local completed_json skipped_json report
  # "${ARR[@]+"${ARR[@]}"}" (not bare "${ARR[@]}") — under `set -u`, stock macOS
  # /bin/bash (3.2) throws "unbound variable" expanding an empty array; this
  # idiom only expands when the array actually has elements.
  completed_json="$(to_json_array "${COMPLETED[@]+"${COMPLETED[@]}"}")"
  skipped_json="$(to_json_array "${SKIPPED[@]+"${SKIPPED[@]}"}")"
  report="$(node --input-type=module -e '
    import { formatPublishFailure } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [targetsJson, completedJson, skippedJson, failedStep, failureDetail] = process.argv.slice(1);
    process.stdout.write(formatPublishFailure({
      targets: JSON.parse(targetsJson),
      completed: JSON.parse(completedJson),
      skipped: JSON.parse(skippedJson),
      failedStep,
      failureDetail,
    }));
  ' "$TARGETS_JSON" "$completed_json" "$skipped_json" "$step" "$detail")"
  printf '\n%s\n' "$report" >&2
  exit 1
}

# ── tag-push ──
if [[ "$TAG_PUSH_ACTION" == "run" ]]; then
  say "Bumping version to $NEXT"
  ( cd "$APP" && npm version "$NEXT" --no-git-tag-version --allow-same-version >/dev/null )
  # npm version touches package.json (and package-lock.json if present).

  HEAD_VERSION="$(head_committed_version)"
  if [[ "$HEAD_VERSION" != "$NEXT" ]]; then
    git -C "$ROOT" add "$APP/package.json" "$APP/package-lock.json" || publish_fail tag-push "git add failed"
    git -C "$ROOT" commit -q -m "release: $TAG" || publish_fail tag-push "git commit failed"
  fi
  git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 \
    || git -C "$ROOT" tag "$TAG" || publish_fail tag-push "git tag failed"
  if git -C "$ROOT" rev-parse -q --verify '@{u}' >/dev/null 2>&1; then
    if [[ "$(git -C "$ROOT" rev-list --count '@{u}..HEAD')" -gt 0 ]]; then
      git -C "$ROOT" push -q origin HEAD || publish_fail tag-push "git push origin HEAD failed"
    fi
  else
    git -C "$ROOT" push -q origin HEAD || publish_fail tag-push "git push origin HEAD failed (no upstream set)"
  fi
  git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 \
    || git -C "$ROOT" push -q origin "$TAG" || publish_fail tag-push "git push origin $TAG failed"
  COMPLETED+=("tag-push")
else
  SKIPPED+=("tag-push")
fi

# ── ci-build ──
if [[ "$CI_BUILD_ACTION" == "run" ]]; then
  say "Waiting for the CI release run for $TAG (build + notarization typically takes 15-40 minutes)"
  RUN_JSON="[]"
  attempt=1
  while [[ "$attempt" -le "$RUN_LOOKUP_ATTEMPTS" ]]; do
    RUN_JSON="$(gh run list -R "$SOURCE_REPO" --workflow "$RELEASE_WORKFLOW" --branch "$TAG" --limit 1 --json databaseId,url 2>/dev/null || echo '[]')"
    [[ "$(node -pe 'JSON.parse(process.argv[1]).length' "$RUN_JSON")" == "1" ]] && break
    sleep "$RUN_LOOKUP_INTERVAL_SECS"
    attempt=$((attempt + 1))
  done
  [[ "$(node -pe 'JSON.parse(process.argv[1]).length' "$RUN_JSON")" == "1" ]] \
    || publish_fail ci-build "no Release workflow run appeared for $TAG within $((RUN_LOOKUP_ATTEMPTS * RUN_LOOKUP_INTERVAL_SECS))s — check https://github.com/$SOURCE_REPO/actions/workflows/$RELEASE_WORKFLOW"
  RUN_ID="$(node -pe 'JSON.parse(process.argv[1])[0].databaseId' "$RUN_JSON")"
  RUN_URL="$(node -pe 'JSON.parse(process.argv[1])[0].url' "$RUN_JSON")"
  say "CI run: $RUN_URL"
  gh run watch "$RUN_ID" -R "$SOURCE_REPO" --exit-status \
    || publish_fail ci-build "the CI release run failed: $RUN_URL — inspect it with: gh run view $RUN_ID -R $SOURCE_REPO --log-failed. Nothing is public: the release is still a draft or was never created."
  COMPLETED+=("ci-build")
else
  say "CI build skipped — $(step_reason ci-build)"
  SKIPPED+=("ci-build")
fi

# ── verify-published ──
say "Verifying what CI published"
STATE_JSON="$(gather_publish_state)"
VERIFY_JSON="$(node --input-type=module -e '
  import { verifyPublishedRelease } from "'"$ROOT"'/packages/shared/dist/index.js";
  const [stateJson, targetsJson] = process.argv.slice(1);
  process.stdout.write(JSON.stringify(verifyPublishedRelease(JSON.parse(stateJson), JSON.parse(targetsJson))));
' "$STATE_JSON" "$TARGETS_JSON")"
if [[ "$(node -pe 'JSON.parse(process.argv[1]).ok' "$VERIFY_JSON")" != "true" ]]; then
  publish_fail verify-published "$(node -pe 'JSON.parse(process.argv[1]).error' "$VERIFY_JSON")"
fi
say "$(node -pe 'JSON.parse(process.argv[1]).notice' "$VERIFY_JSON")"
COMPLETED+=("verify-published")

say "Done → $RELEASE_URL"
