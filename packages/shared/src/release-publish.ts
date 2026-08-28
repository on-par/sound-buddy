// Publish-phase decision logic (#623). Pure functions only — no fs/child_process
// here. scripts/release.sh gathers observed git/gh state, calls these, and acts
// on the result, mirroring the signing.ts ⇄ afterPack.js and dmg-notarization.ts
// ⇄ afterAllArtifactBuild.js precedent.
//
// The core property this module protects: the tag push is the only mutation
// this script makes; .github/workflows/release.yml is the sole producer and
// publisher, and it stages a draft it promotes last (ADR-0095).

import { ELECTRON_UPDATER_MANIFEST_FILENAME, RELEASE_MANIFEST_FILENAME, RELEASES_REPO } from './release-manifest.js';

export const PUBLISH_STEPS = ['tag-push', 'ci-build', 'verify-published'] as const;
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
  const published = state.release !== null && state.release.isDraft === false && hasZip && hasDmg;
  if (published) {
    steps.push({ step: 'ci-build', action: 'skip', reason: `CI already built and published ${targets.tag}` });
  } else {
    steps.push({
      step: 'ci-build',
      action: 'run',
      reason: `waiting for the tagged CI run to build, sign, notarize and publish ${targets.tag}`,
    });
  }

  steps.push({
    step: 'verify-published',
    action: 'run',
    reason:
      `confirming ${targets.tag} is published on ${RELEASES_REPO} with ${targets.zipAssetName}, ` +
      `${targets.dmgAssetName}, ${RELEASE_MANIFEST_FILENAME} and ${ELECTRON_UPDATER_MANIFEST_FILENAME}`,
  });

  return { ok: true, steps, resumed: steps.some((s) => s.action === 'skip') };
}

export type PublishedVerdict = { ok: true; notice: string } | { ok: false; error: string };

/** Judges what CI actually published for `targets.tag`, after the tagged Release workflow run has succeeded. */
export function verifyPublishedRelease(state: PublishState, targets: PublishTargets): PublishedVerdict {
  if (state.release === null) {
    return {
      ok: false,
      error:
        `no release for ${targets.tag} exists on ${RELEASES_REPO} even though the CI run succeeded — check that ` +
        `the run had RELEASES_TOKEN configured, then inspect https://github.com/${RELEASES_REPO}/releases`,
    };
  }

  if (state.release.isDraft) {
    return {
      ok: false,
      error:
        `release ${targets.tag} is still a draft — CI's promote step did not run; inspect the run, then finish it with ` +
        `gh api -X PATCH repos/${RELEASES_REPO}/releases/${state.release.id} -F draft=false`,
    };
  }

  const required = [targets.zipAssetName, targets.dmgAssetName, RELEASE_MANIFEST_FILENAME, ELECTRON_UPDATER_MANIFEST_FILENAME];
  const missing = required.filter((name) => !state.assetNames.includes(name));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `published release ${targets.tag} is missing ${missing.join(', ')} — auto-update and the download button read ` +
        `those assets; re-run the Release workflow for ${targets.tag} from the Actions tab`,
    };
  }

  return {
    ok: true,
    notice: `published ${targets.tag} on ${RELEASES_REPO} with ${targets.zipAssetName}, ${targets.dmgAssetName}, latest.json and latest-mac.yml`,
  };
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

  if (completed.includes('tag-push') || skipped.includes('tag-push')) {
    lines.push(
      'NOTE: the tag is already pushed, so the CI release run may still be building or may already ' +
        'have published this version — check the run before re-running.',
    );
  } else {
    lines.push('Nothing was pushed — no CI run was triggered and no release exists.');
  }
  lines.push('');
  lines.push(`Resume with: ${resumeCommand(targets.version)}`);

  return lines.join('\n');
}

export function resumeCommand(version: string): string {
  return `scripts/release.sh ${version} --yes`;
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

// #1239: the local build/publish path was the second producer that raced CI
// and could make an unsigned or superseded zip `releases/latest`. These
// patterns must never reappear in scripts/release.sh — the tagged Release
// workflow is now the only producer and the only publisher.
const FORBIDDEN_LOCAL_RELEASE_PATTERNS: readonly { pattern: RegExp; problem: string }[] = [
  { pattern: /\bnpm run dist\b/, problem: 'builds artifacts locally — CI is the only producer (#1239)' },
  { pattern: /\bgh release create\b/, problem: 'creates the GitHub release — CI publishes it (#1239)' },
  { pattern: /uploads\.github\.com/, problem: 'uploads a release asset — CI uploads every asset (#1239)' },
  { pattern: /-F draft=false/, problem: 'promotes the release out of draft — CI promotes as its last step (#1239)' },
];
const CI_RUN_WAIT_PATTERN = /gh run watch[^\n]*--exit-status/;

/** Forbids the local build/publish path from reappearing in release.sh, and requires it to wait on the tagged CI run (#1239). */
export function auditLocalReleaseScript(scriptText: string): ReleaseScriptAudit {
  const problems: string[] = [];
  const lines = scriptText.split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, problem } of FORBIDDEN_LOCAL_RELEASE_PATTERNS) {
      if (pattern.test(line)) {
        problems.push(`line ${i + 1}: ${problem}: ${line.trim()}`);
      }
    }
  });
  if (!CI_RUN_WAIT_PATTERN.test(scriptText)) {
    problems.push(
      'does not wait on the tagged CI run with "gh run watch … --exit-status" — a release must not be reported ' +
        'as done before CI has finished (#1239)',
    );
  }
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
