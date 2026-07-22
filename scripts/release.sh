#!/usr/bin/env bash
#
# Publish a new self-contained macOS release of Sound Buddy to the PUBLIC
# download repo (on-par/sound-buddy-releases).
#
# No stored tokens, no CI secret — it uses your local `gh` auth. It bumps the
# version, builds the self-contained .app, tags the source repo, and publishes
# the zip to the public repo.
#
# Publishing is two-phase and resumable (#623):
#   Phase A (build + verify) does not mutate anything outward-facing.
#   Phase B (publish) stages the release as a GitHub *draft* first — a draft
#   is never `releases/latest`, so update discovery (latest.json and
#   electron-updater's latest-mac.yml, #625) keeps serving the previous good
#   release until the final `promote` step flips it. Both manifests are
#   staged on the draft before promote, so neither ever advertises a version
#   before the artifact backing it is live. Every Phase B step before
#   `promote` is safe to retry: re-running the same version converges instead
#   of double-publishing. If a step fails, the script prints exactly which
#   steps completed and the one command to resume (re-run with the explicit
#   version, e.g. `scripts/release.sh 0.8.6 --yes`).
#
# Usage:
#   scripts/release.sh              # patch bump  (0.2.1 -> 0.2.2)
#   scripts/release.sh minor        # minor bump  (0.2.1 -> 0.3.0)
#   scripts/release.sh major        # major bump  (0.2.1 -> 1.0.0)
#   scripts/release.sh 0.5.0        # explicit version (also how you resume a failed run)
#   scripts/release.sh patch --dry-run   # do everything except mutate/publish
#   scripts/release.sh --yes        # skip the confirmation prompt
#
# Set SOUND_BUDDY_SIGNING_IDENTITY + SOUND_BUDDY_NOTARY_PROFILE (both, or
# neither) to produce a Developer ID-signed, notarized, stapled release — see
# docs/signing-and-notarization.md for one-time setup.
#
set -euo pipefail

PUBLIC_REPO="on-par/sound-buddy-releases"
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
for tool in gh node npm git sox ffmpeg ffprobe dylibbundler curl; do
  command -v "$tool" >/dev/null 2>&1 || die "missing '$tool'. Build tools: brew install sox ffmpeg dylibbundler"
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
# --dry-run plan preview, and Phase B.
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
# untagged on GitHub until it's published (#645), so `gh release view $TAG`
# (which resolves by git tag) 404s for a stranded draft — list releases
# instead and match by tag_name, which drafts do carry. per_page=100 is far
# above this repo's release count; no pagination needed.
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

# Signing is env-driven (#53): set SOUND_BUDDY_SIGNING_IDENTITY and
# SOUND_BUDDY_NOTARY_PROFILE to produce a Developer ID-signed, notarized,
# stapled release; leave both unset for an unsigned build. Resolution +
# validation live in packages/shared (resolveSigningConfig) so the
# both-or-neither rule is tested.
SIGNING_JSON="$(node --input-type=module -e '
  import { resolveSigningConfig } from "'"$ROOT"'/packages/shared/dist/index.js";
  try { console.log(JSON.stringify(resolveSigningConfig(process.env))); }
  catch (e) { console.error(e.message); process.exit(1); }
')" || die "signing configuration invalid — see error above"
SIGNED="$(node -pe 'JSON.parse(process.argv[1]).signed' "$SIGNING_JSON")"
IDENTITY="$(node -pe 'JSON.parse(process.argv[1]).identity ?? ""' "$SIGNING_JSON")"
IDENTITY_NAME="$(node -pe 'JSON.parse(process.argv[1]).identityName ?? ""' "$SIGNING_JSON")"
NOTARY_PROFILE="$(node -pe 'JSON.parse(process.argv[1]).notaryProfile ?? ""' "$SIGNING_JSON")"
say "Release notes: $([ "$SIGNED" = "true" ] && echo "signed" || echo "unsigned") build"

if [[ "$SIGNED" == "true" ]]; then
  security find-identity -v -p codesigning | grep -Fq "$IDENTITY" \
    || die "certificate \"$IDENTITY\" not found in the keychain — open Keychain Access and confirm the Developer ID Application certificate + private key are installed (docs/signing-and-notarization.md)"
  command -v xcrun >/dev/null 2>&1 || die "xcrun not found — install Xcode Command Line Tools: xcode-select --install"
fi

HIGHLIGHTS=""
# The leading HTML comment is an editor-only instruction — strip it so it
# never ships as literal text in the published release notes (GitHub hides
# HTML comments in rendered markdown, but `gh release view`/the API/RSS show
# raw markdown as-is).
[[ -f "$ROOT/RELEASE_HIGHLIGHTS.md" ]] && HIGHLIGHTS="$(sed -E '/^<!--.*-->[[:space:]]*$/d' "$ROOT/RELEASE_HIGHLIGHTS.md")"

# Before cutting a release, also edit app/assets/whats-new.md (#271) — its
# bullets become the in-app "what's new" note shown once after users update.
# Leave it empty / delete it for a build with nothing to announce. It ships
# automatically via electron-builder's `assets` extraResources mapping, so no
# script logic here needs to change.

NOTES="$(node --input-type=module -e '
  import { buildReleaseNotes } from "'"$ROOT"'/packages/shared/dist/index.js";
  process.stdout.write(buildReleaseNotes({
    version: process.argv[1],
    signed: process.argv[2] === "true",
    highlights: process.argv[3] || undefined,
  }));
' "$NEXT" "$SIGNED" "$HIGHLIGHTS")"

if [[ "$DRY_RUN" == 1 ]]; then
  say "Dry run — manifest that would be published as latest.json:"
  node --input-type=module -e '
    import { buildReleaseManifestPreview, RELEASE_MANIFEST_URL } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [version, notes, releaseUrl, artifactUrl, signed] = process.argv.slice(1);
    const preview = buildReleaseManifestPreview({
      version, notes, releaseUrl, artifactUrl, signed: signed === "true",
    });
    console.log(JSON.stringify(preview, null, 2));
    console.log(`\nStable download URL: ${RELEASE_MANIFEST_URL}`);
  ' "$NEXT" "$NOTES" "$RELEASE_URL" "$ARTIFACT_URL" "$SIGNED" \
    || die "manifest preview failed — see error above"

  say "Dry run — latest-mac.yml (electron-updater's feed manifest, #625) would be generated by the build itself and uploaded alongside latest.json in the manifest-upload step."

  say "Dry run — publish plan for the observed state (what a real run would do):"
  node --input-type=module -e '
    import { planReleasePublish } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [stateJson, targetsJson] = process.argv.slice(1);
    const plan = planReleasePublish(JSON.parse(stateJson), JSON.parse(targetsJson));
    if (!plan.ok) { console.error(plan.error); process.exit(1); }
    for (const s of plan.steps) console.log(`  [${s.action}] ${s.step} — ${s.reason}`);
  ' "$STATE_JSON" "$TARGETS_JSON" \
    || die "publish plan preview failed — see error above"

  say "Dry run — stopping before version bump / build / publish."
  exit 0
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  printf '\033[1;33mRelease %s to %s? [y/N] \033[0m' "$TAG" "$PUBLIC_REPO"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
fi

# ── Phase A: build + verify (nothing published yet) ─────────────────────────
say "── Phase A: build + verify (nothing published yet) ──"

say "Bumping version to $NEXT"
( cd "$APP" && npm version "$NEXT" --no-git-tag-version --allow-same-version >/dev/null )
# npm version touches package.json (and package-lock.json if present).

say "Building self-contained app (this takes a minute)"
if [[ "$SIGNED" == "true" ]]; then
  # Two formats, one cert: afterPack/codesign wants the full "Developer ID Application: …"
  # string; electron-builder rejects that prefix and wants the bare name (#619).
  # APPLE_KEYCHAIN_PROFILE is how electron-builder hands our notarytool keychain profile to
  # @electron/notarize — it submits, waits, and staples the ticket before zipping (#621).
  # Output is NOT silenced here: any signing/notarization/staple failure and its full error
  # text land directly in this log. @electron/notarize does not print the Apple submission id
  # on a successful run (only on failure, and only into its own debug channel) — look up a
  # past submission's id with: xcrun notarytool history --keychain-profile $NOTARY_PROFILE
  ( cd "$APP" && SOUND_BUDDY_SIGNING_IDENTITY="$IDENTITY" SOUND_BUDDY_NOTARY_PROFILE="$NOTARY_PROFILE" \
      APPLE_KEYCHAIN_PROFILE="$NOTARY_PROFILE" \
      npm run dist -- -c.mac.identity="$IDENTITY_NAME" -c.mac.notarize=true ) \
    || die "signed build failed during signing, notarization, or stapling — check the output above for the exact error. If Apple rejected the notarization, find the submission id there and read the full log with: xcrun notarytool log <submission-id> --keychain-profile $NOTARY_PROFILE"
else
  ( cd "$APP" && npm run dist >/dev/null )
fi

ZIP="$APP/release/$ZIP_ASSET_NAME"
[[ -f "$ZIP" ]] || die "expected zip not found: $ZIP"
DMG="$APP/release/$DMG_ASSET_NAME"
[[ -f "$DMG" ]] || die "expected dmg not found: $DMG — check the dmg target in app/electron-builder.yml"
UPDATE_INFO_PATH="$APP/release/latest-mac.yml"
[[ -f "$UPDATE_INFO_PATH" ]] || die "electron-builder did not generate latest-mac.yml — confirm the publish: block in app/electron-builder.yml still names provider github / owner on-par / repo sound-buddy-releases, then re-run"
# Sanity: the bundle must actually be self-contained.
APP_RES="$APP/release/mac-arm64/Sound Buddy.app/Contents/Resources"
[[ -x "$APP_RES/bin/sox" && -x "$APP_RES/python/bin/python3" ]] || die "bundle is missing sox/python — build problem"
say "Built $(basename "$ZIP") ($(du -h "$ZIP" | cut -f1)), $(basename "$DMG") ($(du -h "$DMG" | cut -f1))"

# electron-builder already submitted to Apple, stapled the ticket, and *then*
# zipped the stapled .app (#621). Everything below is verification only — no
# mutation of the artifact, so $ZIP stays exactly what gets uploaded.
if [[ "$SIGNED" == "true" ]]; then
  APP_BUNDLE="$APP/release/mac-arm64/Sound Buddy.app"

  say "Verifying Developer ID signature"
  codesign --verify --deep --strict "$APP_BUNDLE" \
    || die "codesign verification failed — a nested binary is unsigned or the seal is broken; run: codesign --verify --deep --strict --verbose=4 \"$APP_BUNDLE\""

  say "Validating the stapled notarization ticket"
  STAPLER_OUT="$(xcrun stapler validate "$APP_BUNDLE" 2>&1 || true)"
  node --input-type=module -e '
    import { parseStaplerValidation } from "'"$ROOT"'/packages/shared/dist/index.js";
    const v = parseStaplerValidation(process.argv[1]);
    if (!v.stapled) { console.error(v.error); process.exit(1); }
    console.log("stapler: valid ticket stapled");
  ' "$STAPLER_OUT" || die "stapled-ticket validation failed — the build must not ship; see error above"

  say "Assessing with Gatekeeper (spctl)"
  SPCTL_OUT="$(spctl --assess --type execute --verbose=4 "$APP_BUNDLE" 2>&1 || true)"
  node --input-type=module -e '
    import { parseSpctlAssessment } from "'"$ROOT"'/packages/shared/dist/index.js";
    const v = parseSpctlAssessment(process.argv[1]);
    if (!v.accepted) { console.error(v.error); process.exit(1); }
    console.log("spctl: accepted");
  ' "$SPCTL_OUT" || die "Gatekeeper assessment failed — the build must not ship; see error above"

  # electron-builder does not notarize the dmg itself (#622) —
  # app/build/afterAllArtifactBuild.js submitted + stapled it separately
  # during the build above. Verify that ticket landed before publishing.
  say "Validating the stapled DMG notarization ticket"
  DMG_STAPLER_OUT="$(xcrun stapler validate "$DMG" 2>&1 || true)"
  node --input-type=module -e '
    import { parseStaplerValidation } from "'"$ROOT"'/packages/shared/dist/index.js";
    const v = parseStaplerValidation(process.argv[1]);
    if (!v.stapled) { console.error(v.error); process.exit(1); }
    console.log("stapler: valid ticket stapled to dmg");
  ' "$DMG_STAPLER_OUT" || die "DMG stapled-ticket validation failed — the build must not ship; see error above"

  say "Assessing the DMG with Gatekeeper (spctl)"
  DMG_SPCTL_OUT="$(spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG" 2>&1 || true)"
  node --input-type=module -e '
    import { parseSpctlAssessment } from "'"$ROOT"'/packages/shared/dist/index.js";
    const v = parseSpctlAssessment(process.argv[1]);
    if (!v.accepted) { console.error(v.error); process.exit(1); }
    console.log("spctl: dmg accepted");
  ' "$DMG_SPCTL_OUT" || die "DMG Gatekeeper assessment failed — the build must not ship; see error above"
fi

say "Phase A complete — nothing user-visible has changed yet (no push, no GitHub release)."

# ── Phase B: publish (idempotent) ────────────────────────────────────────────
say "── Phase B: publish (idempotent) ──"

# The tag/release/assets may already exist from an earlier, partially-completed
# attempt at this same version — re-observe state right before publishing.
STATE_JSON="$(gather_publish_state)"
RELEASE_ID="$(node -pe 'JSON.parse(process.argv[1]).release?.id ?? ""' "$STATE_JSON")"
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
for step in tag-push draft-release checksum-verify manifest-upload promote; do
  say "  [$(step_action "$step")] $step — $(step_reason "$step")"
done

TAG_PUSH_ACTION="$(step_action tag-push)"
DRAFT_RELEASE_ACTION="$(step_action draft-release)"
CHECKSUM_VERIFY_ACTION="$(step_action checksum-verify)"
PROMOTE_ACTION="$(step_action promote)"
RELEASE_EXISTS="$(node -pe 'JSON.parse(process.argv[1]).release !== null' "$STATE_JSON")"

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

# ── draft-release ──
if [[ "$DRAFT_RELEASE_ACTION" == "run" ]]; then
  if [[ "$RELEASE_EXISTS" != "true" ]]; then
    gh release create "$TAG" "$ZIP" "$DMG" -R "$PUBLIC_REPO" \
      --draft \
      --title "Sound Buddy $TAG (macOS Apple Silicon)" \
      --notes "$NOTES" \
      || publish_fail draft-release "gh release create --draft failed"
    # A freshly-created draft is untagged on GitHub until published (#645) — its
    # id isn't known yet. Re-resolve it by tag_name via the list endpoint.
    STATE_JSON="$(gather_publish_state)"
    RELEASE_ID="$(node -pe 'JSON.parse(process.argv[1]).release?.id ?? ""' "$STATE_JSON")"
    [[ -n "$RELEASE_ID" ]] \
      || publish_fail draft-release "draft was created but could not be found by tag_name $TAG in repos/$PUBLIC_REPO/releases — check https://github.com/$PUBLIC_REPO/releases and re-run: scripts/release.sh $NEXT --yes"
  else
    # Re-using an existing draft from a prior attempt — upload only what's missing.
    MISSING_ASSETS=()
    [[ "$(node -pe 'JSON.parse(process.argv[1]).assetNames.includes(process.argv[2])' "$STATE_JSON" "$ZIP_ASSET_NAME")" == "true" ]] \
      || MISSING_ASSETS+=("$ZIP")
    [[ "$(node -pe 'JSON.parse(process.argv[1]).assetNames.includes(process.argv[2])' "$STATE_JSON" "$DMG_ASSET_NAME")" == "true" ]] \
      || MISSING_ASSETS+=("$DMG")
    gh release upload "$TAG" "${MISSING_ASSETS[@]+"${MISSING_ASSETS[@]}"}" -R "$PUBLIC_REPO" --clobber \
      || publish_fail draft-release "gh release upload (missing assets) failed"
  fi
  COMPLETED+=("draft-release")
else
  SKIPPED+=("draft-release")
fi

# ── artifact facts (what is ACTUALLY attached to the release right now) ──
# When draft-release just uploaded this run's local build, that local file IS
# the release asset. When draft-release was skipped (assets already present
# from an earlier run), the local rebuild is a *different* build — Phase A has
# no artifact caching and a signed build's notarization ticket is not
# byte-reproducible across submissions — so latest.json must describe the
# remote asset's real facts, not a fresh local rebuild that was never uploaded.
if [[ "$DRAFT_RELEASE_ACTION" == "run" ]]; then
  ZIP_SHA256="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
  ZIP_SIZE="$(stat -f%z "$ZIP")"
else
  REMOTE_ZIP_JSON="$(gh api "repos/$PUBLIC_REPO/releases/$RELEASE_ID" \
    --jq ".assets[] | select(.name == \"$ZIP_ASSET_NAME\")")"
  ZIP_SIZE="$(node -pe 'JSON.parse(process.argv[1]).size' "$REMOTE_ZIP_JSON")"
  REMOTE_DIGEST="$(node -pe 'JSON.parse(process.argv[1]).digest ?? ""' "$REMOTE_ZIP_JSON")"
  if [[ -n "$REMOTE_DIGEST" ]]; then
    ZIP_SHA256="${REMOTE_DIGEST#sha256:}"
  else
    # Older GitHub deployments may not expose asset digests — fall back to
    # downloading the uploaded bytes and hashing them locally. `gh release
    # download` works against drafts for authenticated users.
    ZIP_SHA256="$(gh release download "$TAG" -R "$PUBLIC_REPO" --pattern "$ZIP_ASSET_NAME" -O - | shasum -a 256 | cut -d' ' -f1)"
  fi
fi

# ── checksum-verify (only meaningful when draft-release just uploaded THIS
#    run's build — re-verifying a fresh rebuild against bytes a *previous* run
#    already uploaded would be a false mismatch, not a real corruption signal,
#    and would permanently deadlock every resume) ──
if [[ "$CHECKSUM_VERIFY_ACTION" == "run" ]]; then
  UPLOADED_DIGEST="$(gh api "repos/$PUBLIC_REPO/releases/$RELEASE_ID" \
    --jq ".assets[] | select(.name == \"$ZIP_ASSET_NAME\") | .digest // \"\"")"
  if [[ -z "$UPLOADED_DIGEST" ]]; then
    UPLOADED_DIGEST="$(gh release download "$TAG" -R "$PUBLIC_REPO" --pattern "$ZIP_ASSET_NAME" -O - | shasum -a 256 | cut -d' ' -f1)"
  fi
  CHECKSUM_JSON="$(node --input-type=module -e '
    import { verifyUploadedArtifactChecksum } from "'"$ROOT"'/packages/shared/dist/index.js";
    const [expected, actual] = process.argv.slice(1);
    process.stdout.write(JSON.stringify(verifyUploadedArtifactChecksum(expected, actual)));
  ' "$ZIP_SHA256" "$UPLOADED_DIGEST")"
  if [[ "$(node -pe 'JSON.parse(process.argv[1]).ok' "$CHECKSUM_JSON")" != "true" ]]; then
    publish_fail checksum-verify "$(node -pe 'JSON.parse(process.argv[1]).error' "$CHECKSUM_JSON")"
  fi
  say "Checksum verified: uploaded artifact matches the local build"
  COMPLETED+=("checksum-verify")
else
  say "Checksum verify skipped — $ZIP_ASSET_NAME was already uploaded and verified in a previous run"
  SKIPPED+=("checksum-verify")
fi

# ── manifest-upload (always runs — idempotent via --clobber) ──
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MANIFEST_PATH="$APP/release/latest.json"
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { buildReleaseManifest } from "'"$ROOT"'/packages/shared/dist/index.js";
  const [version, notes, releaseUrl, artifactUrl, size, sha256, publishedAt, out, signed] = process.argv.slice(1);
  const manifest = buildReleaseManifest({
    version, notes, releaseUrl, artifactUrl,
    artifactSizeBytes: Number(size), sha256, publishedAt,
    signed: signed === "true",
  });
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
' "$NEXT" "$NOTES" "$RELEASE_URL" "$ARTIFACT_URL" "$ZIP_SIZE" "$ZIP_SHA256" "$PUBLISHED_AT" "$MANIFEST_PATH" "$SIGNED" \
  || publish_fail manifest-upload "manifest generation failed"
gh release upload "$TAG" "$MANIFEST_PATH" -R "$PUBLIC_REPO" --clobber \
  || publish_fail manifest-upload "gh release upload of latest.json failed"
say "Manifest → https://github.com/$PUBLIC_REPO/releases/latest/download/latest.json"
say "Update feed → https://github.com/$PUBLIC_REPO/releases/latest/download/latest-mac.yml"

# electron-updater's manifest (#625) — only safe to (re-)upload when this
# run's local build is the asset the release actually carries; see
# planUpdateInfoUpload's doc comment.
UPDATE_INFO_UPLOADED="$(node -pe 'JSON.parse(process.argv[1]).assetNames.includes("latest-mac.yml")' "$STATE_JSON")"
UPDATE_INFO_PLAN="$(node --input-type=module -e '
  import { planUpdateInfoUpload } from "'"$ROOT"'/packages/shared/dist/index.js";
  const [ran, uploaded] = process.argv.slice(1);
  process.stdout.write(JSON.stringify(planUpdateInfoUpload(ran === "run", uploaded === "true")));
' "$DRAFT_RELEASE_ACTION" "$UPDATE_INFO_UPLOADED")"
UPDATE_INFO_ACTION="$(node -pe 'JSON.parse(process.argv[1]).action' "$UPDATE_INFO_PLAN")"
case "$UPDATE_INFO_ACTION" in
  fail)
    publish_fail manifest-upload "$(node -pe 'JSON.parse(process.argv[1]).error' "$UPDATE_INFO_PLAN")"
    ;;
  upload)
    gh release upload "$TAG" "$UPDATE_INFO_PATH" -R "$PUBLIC_REPO" --clobber \
      || publish_fail manifest-upload "gh release upload of latest-mac.yml failed"
    ;;
  skip)
    say "$(node -pe 'JSON.parse(process.argv[1]).reason' "$UPDATE_INFO_PLAN")"
    ;;
esac
COMPLETED+=("manifest-upload")

# ── promote (the only user-visible flip) ──
# Promote by numeric id, not by tag — an untagged draft has no
# releases/tags/$TAG endpoint to edit (#645). Publishing an untagged draft
# makes GitHub create the $TAG git tag itself; verify that lands (AC1).
if [[ "$PROMOTE_ACTION" == "run" ]]; then
  gh api -X PATCH "repos/$PUBLIC_REPO/releases/$RELEASE_ID" -F draft=false --silent \
    || publish_fail promote "PATCH releases/$RELEASE_ID draft=false failed — the release is fully staged as a draft with all assets; one command finishes it: gh api -X PATCH repos/$PUBLIC_REPO/releases/$RELEASE_ID -F draft=false"
  # The PATCH above is the actual user-visible flip — record it as completed
  # before the read-only check below, so a failure there (e.g. transient
  # read-after-write lag) reports via formatPublishFailure's "promote already
  # ran" warning instead of the misleading "no users are affected" message.
  COMPLETED+=("promote")
  gh api "repos/$PUBLIC_REPO/releases/tags/$TAG" --jq .id >/dev/null \
    || publish_fail promote "release was un-drafted but is not reachable at tag $TAG on $PUBLIC_REPO — inspect https://github.com/$PUBLIC_REPO/releases"
else
  SKIPPED+=("promote")
fi

say "Done → $RELEASE_URL"
