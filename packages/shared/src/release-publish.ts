// Publish-phase decision logic (#623). Pure functions only — no fs/child_process
// here. scripts/release.sh gathers observed git/gh state, calls these, and acts
// on the result, mirroring the signing.ts ⇄ afterPack.js and dmg-notarization.ts
// ⇄ afterAllArtifactBuild.js precedent.
//
// The core property this module protects: a draft GitHub release is never
// `releases/latest`, so update discovery (latest.json) stays untouched until
// `promote` — the single step in PUBLISH_STEPS that flips the release visible.
// Every step before it is safe to retry or resume after a failure.

import { RELEASE_MANIFEST_FILENAME, RELEASES_REPO } from './release-manifest.js';

export const PUBLISH_STEPS = ['tag-push', 'draft-release', 'checksum-verify', 'manifest-upload', 'promote'] as const;
export type PublishStep = (typeof PUBLISH_STEPS)[number];

/** Observed state, gathered by release.sh before the publish phase. */
export interface ExistingRelease {
  isDraft: boolean;
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
  if (state.release !== null && hasZip && hasDmg) {
    steps.push({
      step: 'draft-release',
      action: 'skip',
      reason: `release ${targets.tag} already has ${targets.zipAssetName} and ${targets.dmgAssetName}`,
    });
  } else if (state.release === null) {
    steps.push({ step: 'draft-release', action: 'run', reason: `creating draft release ${targets.tag}` });
  } else {
    const missing = [!hasZip ? targets.zipAssetName : null, !hasDmg ? targets.dmgAssetName : null].filter(
      (name): name is string => name !== null,
    );
    steps.push({
      step: 'draft-release',
      action: 'run',
      reason: `re-using existing draft, uploading missing assets: ${missing.join(', ')}`,
    });
  }

  steps.push({
    step: 'checksum-verify',
    action: 'run',
    reason: 'checksum-verify always runs — it is read-only and is the safety property in AC3',
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

  if (!state.release.isDraft && hasZip && hasDmg && hasManifest) {
    return {
      ok: false,
      error:
        `release ${targets.tag} is already fully published on ${RELEASES_REPO} with ${targets.zipAssetName}, ` +
        `${targets.dmgAssetName}, and ${RELEASE_MANIFEST_FILENAME} — nothing is left to resume`,
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
    lines.push('latest.json / update discovery is unchanged — no users are affected.');
  }
  lines.push('');
  lines.push(`Resume with: ${resumeCommand(targets.version)}`);

  return lines.join('\n');
}

export function resumeCommand(version: string): string {
  return `scripts/release.sh ${version} --yes`;
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
