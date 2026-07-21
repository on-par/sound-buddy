import { describe, expect, it } from 'vitest';
import {
  PUBLISH_STEPS,
  classifyWorkingTree,
  evaluateReleasePreflight,
  formatPublishFailure,
  planReleasePublish,
  resumeCommand,
} from './release-publish.js';
import { RELEASE_MANIFEST_FILENAME } from './release-manifest.js';
import type { PublishState, PublishTargets } from './release-publish.js';

const TARGETS: PublishTargets = {
  version: '0.8.6',
  tag: 'v0.8.6',
  zipAssetName: 'Sound.Buddy-0.8.6-arm64-mac.zip',
  dmgAssetName: 'Sound.Buddy-0.8.6-arm64.dmg',
};

const FRESH_STATE: PublishState = {
  tagExistsLocally: false,
  tagExistsOnOrigin: false,
  versionCommitted: false,
  release: null,
  assetNames: [],
};

describe('planReleasePublish', () => {
  it('fresh state: all five steps run, resumed is false', () => {
    const plan = planReleasePublish(FRESH_STATE, TARGETS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error('unreachable');
    expect(plan.steps.map((s) => s.step)).toEqual([...PUBLISH_STEPS]);
    expect(plan.steps.every((s) => s.action === 'run')).toBe(true);
    expect(plan.resumed).toBe(false);
  });

  it('tag pushed + draft release with both assets: tag-push and draft-release skip, checksum-verify/manifest-upload/promote run, resumed true', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: true },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    const byStep = Object.fromEntries(plan.steps.map((s) => [s.step, s]));
    expect(byStep['tag-push'].action).toBe('skip');
    expect(byStep['draft-release'].action).toBe('skip');
    expect(byStep['checksum-verify'].action).toBe('run');
    expect(byStep['manifest-upload'].action).toBe('run');
    expect(byStep['promote'].action).toBe('run');
    expect(plan.resumed).toBe(true);
  });

  it('draft release missing the dmg: draft-release runs and names the missing asset', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: true },
      assetNames: [TARGETS.zipAssetName],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    const draftStep = plan.steps.find((s) => s.step === 'draft-release')!;
    expect(draftStep.action).toBe('run');
    expect(draftStep.reason).toContain(TARGETS.dmgAssetName);
  });

  it('draft release missing the zip: draft-release runs and names the missing asset', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: true },
      assetNames: [TARGETS.dmgAssetName],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    const draftStep = plan.steps.find((s) => s.step === 'draft-release')!;
    expect(draftStep.action).toBe('run');
    expect(draftStep.reason).toContain(TARGETS.zipAssetName);
  });

  it('published (non-draft) release: promote skips', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: false },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    const promoteStep = plan.steps.find((s) => s.step === 'promote')!;
    expect(promoteStep.action).toBe('skip');
    expect(promoteStep.reason).toContain(TARGETS.tag);
  });

  it('tag exists locally but not on origin: tag-push runs', () => {
    const state: PublishState = { ...FRESH_STATE, tagExistsLocally: true, versionCommitted: true };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    expect(plan.steps.find((s) => s.step === 'tag-push')!.action).toBe('run');
  });

  it('version committed but tag absent: tag-push runs', () => {
    const state: PublishState = { ...FRESH_STATE, versionCommitted: true };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    expect(plan.steps.find((s) => s.step === 'tag-push')!.action).toBe('run');
  });
});

describe('evaluateReleasePreflight', () => {
  it('no release: mode is fresh', () => {
    const verdict = evaluateReleasePreflight(FRESH_STATE, TARGETS, false);
    expect(verdict).toEqual({ ok: true, mode: 'fresh', notice: expect.any(String) });
  });

  it('existing draft + explicitVersion true: mode is resume, notice mentions the draft', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: true }, assetNames: [TARGETS.zipAssetName] };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain('draft');
  });

  it('existing release + explicitVersion false: ok false, error names the tag and the exact resume command', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: true }, assetNames: [] };
    const verdict = evaluateReleasePreflight(state, TARGETS, false);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain(TARGETS.tag);
    expect(verdict.error).toContain(resumeCommand(TARGETS.version));
  });

  it('existing published (non-draft, incomplete) release + explicitVersion false: ok false, describes it as published', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: false }, assetNames: [TARGETS.zipAssetName] };
    const verdict = evaluateReleasePreflight(state, TARGETS, false);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain('published');
  });

  it('existing draft + explicitVersion true with no assets yet: resume notice says no assets uploaded', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: true }, assetNames: [] };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.notice).toContain('no assets uploaded yet');
  });

  it('existing draft with all assets already uploaded + explicitVersion true: resume notice lists every asset', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: true },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME],
    };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain(TARGETS.dmgAssetName);
    expect(verdict.notice).toContain(RELEASE_MANIFEST_FILENAME);
  });

  it('existing published (non-draft, incomplete) release + explicitVersion true: resume notice describes it as published', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: false }, assetNames: [TARGETS.zipAssetName] };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain('published');
    expect(verdict.notice).toContain(TARGETS.zipAssetName);
  });

  it('published release already holding zip, dmg, and latest.json: ok false, nothing left to resume', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: false },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME],
    };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain('nothing is left to resume');
  });
});

describe('formatPublishFailure', () => {
  it('failure at manifest-upload after tag-push/draft-release completed', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: ['tag-push', 'draft-release'],
      skipped: [],
      failedStep: 'manifest-upload',
      failureDetail: 'gh release upload timed out',
    });
    expect(output).toContain('tag-push: done');
    expect(output).toContain('draft-release: done');
    expect(output).toContain('manifest-upload: FAILED');
    expect(output).toContain('promote: not run');
    expect(output).toContain('update discovery is unchanged');
    expect(output).toContain(`Resume with: ${resumeCommand(TARGETS.version)}`);
  });

  it('failure at tag-push: nothing completed, resume line present', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: [],
      skipped: [],
      failedStep: 'tag-push',
      failureDetail: 'git push rejected',
    });
    expect(output).not.toContain(': done');
    expect(output).toContain(`Resume with: ${resumeCommand(TARGETS.version)}`);
  });

  it('renders skipped steps distinctly from completed ones', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: ['draft-release'],
      skipped: ['tag-push'],
      failedStep: 'checksum-verify',
      failureDetail: 'checksum mismatch',
    });
    expect(output).toContain('tag-push: skipped (already done)');
    expect(output).toContain('draft-release: done');
    expect(output).toContain('checksum-verify: FAILED');
  });

  it('warns loudly if promote already completed before a later failure (broken order)', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: ['tag-push', 'draft-release', 'checksum-verify', 'manifest-upload', 'promote'],
      skipped: [],
      failedStep: 'manifest-upload',
      failureDetail: 'impossible ordering used only to exercise the defensive branch',
    });
    expect(output.toLowerCase()).toContain('warning');
    expect(output).not.toContain('update discovery is unchanged');
  });
});

describe('resumeCommand', () => {
  it('returns the exact resume command', () => {
    expect(resumeCommand('0.8.6')).toBe('scripts/release.sh 0.8.6 --yes');
  });
});

describe('classifyWorkingTree', () => {
  it('empty porcelain output is clean', () => {
    expect(classifyWorkingTree('')).toBe('clean');
  });

  it('only app/package.json + app/package-lock.json modified is version-bump-only', () => {
    expect(classifyWorkingTree(' M app/package.json\n M app/package-lock.json\n')).toBe('version-bump-only');
  });

  it('a modified source file is dirty', () => {
    expect(classifyWorkingTree(' M app/electron/main.ts\n')).toBe('dirty');
  });

  it('a version bump mixed with another file is dirty', () => {
    expect(classifyWorkingTree(' M app/package.json\n M app/electron/main.ts\n')).toBe('dirty');
  });

  it('an untracked file is dirty', () => {
    expect(classifyWorkingTree('?? junk.txt\n')).toBe('dirty');
  });
});
