// Publish-phase decision logic (#623). Pure functions only — no fs/child_process
// here. scripts/release.sh gathers observed git/gh state, calls these, and acts
// on the result, mirroring the signing.ts ⇄ afterPack.js and dmg-notarization.ts
// ⇄ afterAllArtifactBuild.js precedent.
//
// The core property this module protects: a draft GitHub release is never
// `releases/latest`, so update discovery (latest.json) stays untouched until
// `promote` — the single step in PUBLISH_STEPS that flips the release visible.
// Every step before it is safe to retry or resume after a failure.

import { ELECTRON_UPDATER_MANIFEST_FILENAME, RELEASE_MANIFEST_FILENAME, RELEASES_REPO } from './release-manifest.js';

export const PUBLISH_STEPS = ['tag-push', 'draft-release', 'checksum-verify', 'manifest-upload', 'promote'] as const;
export type PublishStep = (typeof PUBLISH_STEPS)[number];

/** Observed state, gathered by release.sh before the publish phase. */
export interface ExistingRelease {
  id: number;
  isDraft: boolean;
}

/** Shape of one entry from GitHub's list-releases API (snake_case comes from the API). */
export interface ReleaseListEntry {
  id: number;
  tag_name: string;
  draft: boolean;
  assets: readonly { name: string }[];
}

export interface SelectedRelease {
  id: number;
  isDraft: boolean;
  assetNames: string[];
}

/**
 * Picks the release matching `tag` out of GitHub's list-releases response.
 * Unlike `GET /releases/tags/{tag}`, the list endpoint includes drafts whose
 * intended tag was never actually created as a git tag (#645) — draft
 * releases are only tagged once published.
 */
export function selectReleaseByTag(releases: readonly ReleaseListEntry[], tag: string): SelectedRelease | null {
  const matches = releases.filter((r) => r.tag_name === tag);
  if (matches.length === 0) return null;

  const published = matches.find((r) => !r.draft);
  const selected = published ?? matches.reduce((newest, r) => (r.id > newest.id ? r : newest));

  return {
    id: selected.id,
    isDraft: selected.draft,
    assetNames: selected.assets.map((a) => a.name),
  };
}

export interface PublishState {
  tagExistsLocally: boolean;
  tagExistsOnOrigin: boolean;
  /** HEAD's app/package.json version === target version. */
  versionCommitted: boolean;
  release: ExistingRelease | null;
  /** Asset names already present on that release. */
  assetNames: readonly string[];
}

export interface PublishTargets {
  version: string;
  tag: string;
  zipAssetName: string;
  dmgAssetName: string;
}

export interface PublishStepPlan {
  step: PublishStep;
  action: 'run' | 'skip';
  reason: string;
}

export type PublishPlan = { ok: true; steps: PublishStepPlan[]; resumed: boolean } | { ok: false; error: string };

export function planReleasePublish(state: PublishState, targets: PublishTargets): PublishPlan {
  const steps: PublishStepPlan[] = [];

  if (state.versionCommitted && state.tagExistsLocally && state.tagExistsOnOrigin) {
    steps.push({ step: 'tag-push', action: 'skip', reason: `tag ${targets.tag} already pushed to origin` });
  } else {
    steps.push({
      step: 'tag-push',
      action: 'run',
      reason: `tag ${targets.tag} still needs to be committed, created, and/or pushed to origin`,
    });
  }

  const hasZip = state.assetNames.includes(targets.zipAssetName);
  const hasDmg = state.assetNames.includes(targets.dmgAssetName);
  const draftAction: 'run' | 'skip' = state.release !== null && hasZip && hasDmg ? 'skip' : 'run';
  let draftReason: string;
  if (draftAction === 'skip') {
    draftReason = `release ${targets.tag} already has ${targets.zipAssetName} and ${targets.dmgAssetName}`;
  } else if (state.release === null) {
    draftReason = `creating draft release ${targets.tag}`;
  } else {
    const missing = [!hasZip ? targets.zipAssetName : null, !hasDmg ? targets.dmgAssetName : null].filter(
      (name): name is string => name !== null,
    );
    draftReason = `re-using existing draft, uploading missing assets: ${missing.join(', ')}`;
  }
  steps.push({ step: 'draft-release', action: draftAction, reason: draftReason });

  // checksum-verify only has a meaningful comparison to make when draft-release
  // just uploaded THIS run's local build: a resumed run rebuilds from scratch
  // (no artifact caching, by design) and a signed build's notarization ticket
  // is not byte-reproducible across submissions, so comparing a fresh rebuild
  // against bytes a *previous* run already uploaded would be a false mismatch,
  // not a real corruption signal — permanently deadlocking every resume.
  steps.push({
    step: 'checksum-verify',
    action: draftAction,
    reason:
      draftAction === 'run'
        ? 'verifying the artifact just uploaded to the draft matches the local build byte-for-byte — the safety property in AC3'
        : `${targets.zipAssetName} was uploaded in a previous run and is not being re-uploaded — re-verifying a fresh, non-reproducible rebuild against it would be a false mismatch`,
  });

  steps.push({
    step: 'manifest-upload',
    action: 'run',
    reason: 'manifest-upload is idempotent (--clobber) and always re-runs to guarantee latest.json matches the uploaded artifact',
  });

  if (state.release !== null && state.release.isDraft === false) {
    steps.push({ step: 'promote', action: 'skip', reason: `release ${targets.tag} is already published` });
  } else {
    steps.push({ step: 'promote', action: 'run', reason: `promoting release ${targets.tag} out of draft` });
  }

  return { ok: true, steps, resumed: steps.some((s) => s.action === 'skip') };
}

export type PreflightVerdict = { ok: true; mode: 'fresh' | 'resume'; notice: string } | { ok: false; error: string };

/**
 * Decides whether it is safe to proceed for `targets.version` given what already
 * exists remotely. `explicitVersion` is true when the maintainer passed a literal
 * version (e.g. `scripts/release.sh 0.8.6`) rather than patch/minor/major.
 */
export function evaluateReleasePreflight(
  state: PublishState,
  targets: PublishTargets,
  explicitVersion: boolean,
): PreflightVerdict {
  if (state.release === null) {
    return { ok: true, mode: 'fresh', notice: `cutting a new release ${targets.tag} — nothing exists on ${RELEASES_REPO} yet` };
  }

  const hasZip = state.assetNames.includes(targets.zipAssetName);
  const hasDmg = state.assetNames.includes(targets.dmgAssetName);
  const hasManifest = state.assetNames.includes(RELEASE_MANIFEST_FILENAME);
  const hasUpdateInfo = state.assetNames.includes(ELECTRON_UPDATER_MANIFEST_FILENAME);

  if (!state.release.isDraft && hasZip && hasDmg && hasManifest && hasUpdateInfo) {
    return {
      ok: false,
      error:
        `release ${targets.tag} is already fully published on ${RELEASES_REPO} with ${targets.zipAssetName}, ` +
        `${targets.dmgAssetName}, ${RELEASE_MANIFEST_FILENAME}, and ${ELECTRON_UPDATER_MANIFEST_FILENAME} — nothing is left to resume`,
    };
  }

  if (!explicitVersion) {
    return {
      ok: false,
      error:
        `release ${targets.tag} already exists on ${RELEASES_REPO} (${state.release.isDraft ? 'draft' : 'published'}) — ` +
        `resuming requires passing the explicit version. Run: ${resumeCommand(targets.version)}`,
    };
  }

  const status = state.release.isDraft ? 'draft' : 'published';
  const presentAssets = [
    hasZip ? targets.zipAssetName : null,
    hasDmg ? targets.dmgAssetName : null,
    hasManifest ? RELEASE_MANIFEST_FILENAME : null,
    hasUpdateInfo ? ELECTRON_UPDATER_MANIFEST_FILENAME : null,
  ].filter((name): name is string => name !== null);
  const notice =
    `resuming ${status} release ${targets.tag}` +
    (presentAssets.length > 0 ? ` — already has: ${presentAssets.join(', ')}` : ' — no assets uploaded yet');

  return { ok: true, mode: 'resume', notice };
}

export interface PublishOutcomeInput {
  targets: PublishTargets;
  completed: readonly PublishStep[];
  skipped: readonly PublishStep[];
  failedStep: PublishStep;
  failureDetail: string;
}

/** The AC4 report: what completed, what did not, and the single resume command. */
export function formatPublishFailure(input: PublishOutcomeInput): string {
  const { targets, completed, skipped, failedStep, failureDetail } = input;
  const lines: string[] = [];

  lines.push(`Publish failed for ${targets.tag} at step "${failedStep}": ${failureDetail}`);
  lines.push('');
  for (const step of PUBLISH_STEPS) {
    let status: string;
    if (step === failedStep) status = 'FAILED';
    else if (completed.includes(step)) status = 'done';
    else if (skipped.includes(step)) status = 'skipped (already done)';
    else status = 'not run';
    lines.push(`  ${step}: ${status}`);
  }
  lines.push('');

  if (completed.includes('promote')) {
    lines.push(
      'WARNING: promote already ran and the release was published, but a later step failed — this violates ' +
        'the expected publish order (promote must be last); investigate immediately.',
    );
  } else {
    lines.push('latest.json / latest-mac.yml / update discovery is unchanged — no users are affected.');
  }
  lines.push('');
  lines.push(`Resume with: ${resumeCommand(targets.version)}`);

  return lines.join('\n');
}

export function resumeCommand(version: string): string {
  return `scripts/release.sh ${version} --yes`;
}

export type UpdateInfoUploadPlan =
  | { action: 'upload'; reason: string }
  | { action: 'skip'; reason: string }
  | { action: 'fail'; error: string };

/**
 * Decides whether this run may upload its locally-generated latest-mac.yml.
 * The sha512 in latest-mac.yml describes THIS run's local build. When
 * draft-release was skipped, the release already carries a *different*
 * build's zip (Phase A has no artifact caching and a notarized build is not
 * byte-reproducible), so uploading a fresh latest-mac.yml would advertise a
 * checksum the published artifact does not have — AC5's exact failure mode.
 */
export function planUpdateInfoUpload(
  draftReleaseRan: boolean,
  updateInfoAlreadyUploaded: boolean,
): UpdateInfoUploadPlan {
  if (draftReleaseRan) {
    return {
      action: 'upload',
      reason: 'draft-release ran this run — the local build is the asset latest-mac.yml describes',
    };
  }

  if (updateInfoAlreadyUploaded) {
    return {
      action: 'skip',
      reason: 'latest-mac.yml is already uploaded and matches the already-uploaded zip from a previous run',
    };
  }

  return {
    action: 'fail',
    error:
      'latest-mac.yml is missing from this release but its zip was uploaded by an earlier run, so this ' +
      "run's rebuild does not match it (notarized builds are not byte-reproducible). Delete the release " +
      'assets and re-run: scripts/release.sh <version> --yes',
  };
}

/** One entry of a release's `assets` array as returned by GET repos/{repo}/releases/{id}. */
export interface ReleaseAssetRef {
  id: number;
  name: string;
}

/** Exact-name lookup of an asset's numeric id on the id-resolved release; null when absent. */
export function findReleaseAssetId(assets: readonly ReleaseAssetRef[], name: string): number | null {
  return assets.find((a) => a.name === name)?.id ?? null;
}

/** POST target for uploading an asset to a release by numeric id (uploads.github.com, not api.github.com). */
export function buildReleaseAssetUploadUrl(repo: string, releaseId: number, assetName: string): string {
  return `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
}

/** API path for one asset by numeric id — used for both DELETE (clobber) and octet-stream GET (download). */
export function releaseAssetApiPath(repo: string, assetId: number): string {
  return `repos/${repo}/releases/assets/${assetId}`;
}

export interface ReleaseScriptAudit {
  ok: boolean;
  problems: string[];
}

// #648: `gh release upload`/`gh release download` (and view/edit/delete-asset) resolve the
// release by TAG, which can target a different draft than selectReleaseByTag's id-based pick
// when duplicate drafts share a tag_name. The only allowed `gh release` subcommand in
// scripts/release.sh is `create` (it makes a brand-new draft; it never resolves an existing
// one). Everything else must go through id-keyed `gh api` calls.
const FORBIDDEN_GH_RELEASE_SUBCOMMAND = /\bgh release (?!create\b)([a-z-]+)/;

/** Forbids tag-resolved `gh release <sub>` calls (other than `create`) from reappearing in release.sh (#648). */
export function auditReleaseScriptResolution(scriptText: string): ReleaseScriptAudit {
  const problems: string[] = [];
  const lines = scriptText.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(FORBIDDEN_GH_RELEASE_SUBCOMMAND);
    if (m) {
      problems.push(
        `line ${i + 1}: "gh release ${m[1]}" resolves the release by tag and can target the wrong ` +
          `duplicate draft (#648) — use an id-keyed gh api call via $RELEASE_ID instead: ${line.trim()}`,
      );
    }
  });
  return { ok: problems.length === 0, problems };
}

export type TreeState = 'clean' | 'version-bump-only' | 'dirty';

const VERSION_BUMP_FILES = new Set(['app/package.json', 'app/package-lock.json']);
const PORCELAIN_STATUS_WIDTH = 3; // "XY " — two status chars + one space, per `git status --porcelain`.

/**
 * Classify `git status --porcelain` output; only app/package.json + app/package-lock.json
 * modifications count as `version-bump-only` (a resume after a failed run).
 */
export function classifyWorkingTree(porcelain: string): TreeState {
  const lines = porcelain.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return 'clean';

  const files = lines.map((line) => line.slice(PORCELAIN_STATUS_WIDTH));
  return files.every((file) => VERSION_BUMP_FILES.has(file)) ? 'version-bump-only' : 'dirty';
}
