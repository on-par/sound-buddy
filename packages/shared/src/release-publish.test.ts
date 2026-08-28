import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PUBLISH_STEPS,
  auditLocalReleaseScript,
  auditReleaseScriptResolution,
  classifyWorkingTree,
  evaluateReleasePreflight,
  formatPublishFailure,
  planReleasePublish,
  resumeCommand,
  selectReleaseByTag,
  verifyPublishedRelease,
} from './release-publish.js';
import { ELECTRON_UPDATER_MANIFEST_FILENAME, RELEASE_MANIFEST_FILENAME } from './release-manifest.js';
import type { PublishState, PublishTargets, ReleaseListEntry } from './release-publish.js';

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
  it('fresh state: all three steps run, resumed is false', () => {
    const plan = planReleasePublish(FRESH_STATE, TARGETS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error('unreachable');
    expect(plan.steps.map((s) => s.step)).toEqual([...PUBLISH_STEPS]);
    expect(plan.steps.every((s) => s.action === 'run')).toBe(true);
    expect(plan.resumed).toBe(false);
  });

  it('tag pushed + published release carrying zip and dmg: tag-push/ci-build skip, verify-published runs, resumed true; ci-build skip reason names the tag', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: false, id: 100000001 },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    const byStep = Object.fromEntries(plan.steps.map((s) => [s.step, s]));
    expect(byStep['tag-push'].action).toBe('skip');
    expect(byStep['ci-build'].action).toBe('skip');
    expect(byStep['ci-build'].reason).toContain(TARGETS.tag);
    expect(byStep['verify-published'].action).toBe('run');
    expect(plan.resumed).toBe(true);
  });

  it('draft release carrying both assets: ci-build still runs (a draft is not published)', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: true, id: 100000001 },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    expect(plan.steps.find((s) => s.step === 'ci-build')!.action).toBe('run');
  });

  it('published release missing the dmg: ci-build runs', () => {
    const state: PublishState = {
      tagExistsLocally: true,
      tagExistsOnOrigin: true,
      versionCommitted: true,
      release: { isDraft: false, id: 100000001 },
      assetNames: [TARGETS.zipAssetName],
    };
    const plan = planReleasePublish(state, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    expect(plan.steps.find((s) => s.step === 'ci-build')!.action).toBe('run');
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

  it("verify-published's reason mentions latest.json and latest-mac.yml", () => {
    const plan = planReleasePublish(FRESH_STATE, TARGETS);
    if (!plan.ok) throw new Error('unreachable');
    const reason = plan.steps.find((s) => s.step === 'verify-published')!.reason;
    expect(reason).toContain(RELEASE_MANIFEST_FILENAME);
    expect(reason).toContain(ELECTRON_UPDATER_MANIFEST_FILENAME);
  });
});

describe('verifyPublishedRelease', () => {
  it('no release: ok false, error names the tag and RELEASES_TOKEN', () => {
    const verdict = verifyPublishedRelease(FRESH_STATE, TARGETS);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain(TARGETS.tag);
    expect(verdict.error).toContain('RELEASES_TOKEN');
  });

  it('draft release: ok false, error names draft=false and the release id', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: true, id: 100000001 },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME, ELECTRON_UPDATER_MANIFEST_FILENAME],
    };
    const verdict = verifyPublishedRelease(state, TARGETS);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain('draft=false');
    expect(verdict.error).toContain('100000001');
  });

  it('missing only latest-mac.yml: error names exactly that asset, not the others', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: false, id: 100000001 },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME],
    };
    const verdict = verifyPublishedRelease(state, TARGETS);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain(ELECTRON_UPDATER_MANIFEST_FILENAME);
    expect(verdict.error).not.toContain(TARGETS.zipAssetName);
    expect(verdict.error).not.toContain(TARGETS.dmgAssetName);
    expect(verdict.error).not.toContain(RELEASE_MANIFEST_FILENAME);
  });

  it('missing zip, dmg and both manifests: error names all four', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: false, id: 100000001 }, assetNames: [] };
    const verdict = verifyPublishedRelease(state, TARGETS);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain(TARGETS.zipAssetName);
    expect(verdict.error).toContain(TARGETS.dmgAssetName);
    expect(verdict.error).toContain(RELEASE_MANIFEST_FILENAME);
    expect(verdict.error).toContain(ELECTRON_UPDATER_MANIFEST_FILENAME);
  });

  it('fully published: ok true, notice names the tag', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: false, id: 100000001 },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME, ELECTRON_UPDATER_MANIFEST_FILENAME],
    };
    const verdict = verifyPublishedRelease(state, TARGETS);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.notice).toContain(TARGETS.tag);
  });
});

describe('auditLocalReleaseScript', () => {
  const CI_WAIT = 'gh run watch "$RUN_ID" -R "$SOURCE_REPO" --exit-status\n';

  it('flags npm run dist with the 1-indexed line number', () => {
    const script = `line one\nnpm run dist -- -c.releaseInfo.releaseNotes="$NOTES"\n${CI_WAIT}`;
    const result = auditLocalReleaseScript(script);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('line 2') && p.includes('npm run dist'))).toBe(true);
  });

  it('flags gh release create', () => {
    const script = `gh release create "$TAG" "$ZIP" "$DMG" -R "$PUBLIC_REPO" --draft\n${CI_WAIT}`;
    const result = auditLocalReleaseScript(script);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('gh release create'))).toBe(true);
  });

  it('flags an uploads.github.com asset POST', () => {
    const script = `gh api -X POST "https://uploads.github.com/repos/$PUBLIC_REPO/releases/$RELEASE_ID/assets?name=x" --silent\n${CI_WAIT}`;
    const result = auditLocalReleaseScript(script);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('uploads.github.com'))).toBe(true);
  });

  it('flags a -F draft=false promote', () => {
    const script = `gh api -X PATCH "repos/$PUBLIC_REPO/releases/$RELEASE_ID" -F draft=false --silent\n${CI_WAIT}`;
    const result = auditLocalReleaseScript(script);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('-F draft=false'))).toBe(true);
  });

  it('flags a script missing the gh run watch --exit-status wait', () => {
    const result = auditLocalReleaseScript('#!/usr/bin/env bash\nset -euo pipefail\n');
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('gh run watch'))).toBe(true);
  });

  it('a script with the wait and none of the forbidden patterns is clean', () => {
    const script = `#!/usr/bin/env bash\nset -euo pipefail\n${CI_WAIT}`;
    expect(auditLocalReleaseScript(script)).toEqual({ ok: true, problems: [] });
  });
});

describe('evaluateReleasePreflight', () => {
  it('no release: mode is fresh', () => {
    const verdict = evaluateReleasePreflight(FRESH_STATE, TARGETS, false);
    expect(verdict).toEqual({ ok: true, mode: 'fresh', notice: expect.any(String) });
  });

  it('existing draft + explicitVersion true: mode is resume, notice mentions the draft', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: true, id: 100000001 }, assetNames: [TARGETS.zipAssetName] };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain('draft');
  });

  it('existing release + explicitVersion false: ok false, error names the tag and the exact resume command', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: true, id: 100000001 }, assetNames: [] };
    const verdict = evaluateReleasePreflight(state, TARGETS, false);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain(TARGETS.tag);
    expect(verdict.error).toContain(resumeCommand(TARGETS.version));
  });

  it('existing published (non-draft, incomplete) release + explicitVersion false: ok false, describes it as published', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: false, id: 100000001 }, assetNames: [TARGETS.zipAssetName] };
    const verdict = evaluateReleasePreflight(state, TARGETS, false);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain('published');
  });

  it('existing draft + explicitVersion true with no assets yet: resume notice says no assets uploaded', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: true, id: 100000001 }, assetNames: [] };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.notice).toContain('no assets uploaded yet');
  });

  it('existing draft with all assets already uploaded + explicitVersion true: resume notice lists every asset', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: true, id: 100000001 },
      assetNames: [
        TARGETS.zipAssetName,
        TARGETS.dmgAssetName,
        RELEASE_MANIFEST_FILENAME,
        ELECTRON_UPDATER_MANIFEST_FILENAME,
      ],
    };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain(TARGETS.dmgAssetName);
    expect(verdict.notice).toContain(RELEASE_MANIFEST_FILENAME);
    expect(verdict.notice).toContain(ELECTRON_UPDATER_MANIFEST_FILENAME);
  });

  it('existing published (non-draft, incomplete) release + explicitVersion true: resume notice describes it as published', () => {
    const state: PublishState = { ...FRESH_STATE, release: { isDraft: false, id: 100000001 }, assetNames: [TARGETS.zipAssetName] };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain('published');
    expect(verdict.notice).toContain(TARGETS.zipAssetName);
  });

  it('published release already holding zip, dmg, latest.json, and latest-mac.yml: ok false, nothing left to resume', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: false, id: 100000001 },
      assetNames: [
        TARGETS.zipAssetName,
        TARGETS.dmgAssetName,
        RELEASE_MANIFEST_FILENAME,
        ELECTRON_UPDATER_MANIFEST_FILENAME,
      ],
    };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toContain('nothing is left to resume');
  });

  it('published release missing only latest-mac.yml: resumable, not "nothing left"', () => {
    const state: PublishState = {
      ...FRESH_STATE,
      release: { isDraft: false, id: 100000001 },
      assetNames: [TARGETS.zipAssetName, TARGETS.dmgAssetName, RELEASE_MANIFEST_FILENAME],
    };
    const verdict = evaluateReleasePreflight(state, TARGETS, true);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable');
    expect(verdict.mode).toBe('resume');
    expect(verdict.notice).toContain(RELEASE_MANIFEST_FILENAME);
  });
});

describe('formatPublishFailure', () => {
  it('failure at verify-published with tag-push/ci-build completed: shows the "tag is already pushed" note', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: ['tag-push', 'ci-build'],
      skipped: [],
      failedStep: 'verify-published',
      failureDetail: 'release is missing latest-mac.yml',
    });
    expect(output).toContain('tag-push: done');
    expect(output).toContain('ci-build: done');
    expect(output).toContain('verify-published: FAILED');
    expect(output).toContain('already pushed');
    expect(output).toContain(`Resume with: ${resumeCommand(TARGETS.version)}`);
  });

  it('failure at tag-push: nothing completed, "Nothing was pushed" note, resume line present', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: [],
      skipped: [],
      failedStep: 'tag-push',
      failureDetail: 'git push rejected',
    });
    expect(output).not.toContain(': done');
    expect(output).toContain('Nothing was pushed');
    expect(output).toContain(`Resume with: ${resumeCommand(TARGETS.version)}`);
  });

  it('renders skipped steps distinctly from completed ones', () => {
    const output = formatPublishFailure({
      targets: TARGETS,
      completed: ['tag-push'],
      skipped: ['ci-build'],
      failedStep: 'verify-published',
      failureDetail: 'release is still a draft',
    });
    expect(output).toContain('ci-build: skipped (already done)');
    expect(output).toContain('tag-push: done');
    expect(output).toContain('verify-published: FAILED');
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

describe('selectReleaseByTag', () => {
  it('returns null for an empty list', () => {
    expect(selectReleaseByTag([], 'v0.8.4')).toBeNull();
  });

  it('returns null when no entry matches the tag', () => {
    const releases: ReleaseListEntry[] = [{ id: 1, tag_name: 'v0.8.3', draft: false, assets: [] }];
    expect(selectReleaseByTag(releases, 'v0.8.4')).toBeNull();
  });

  it('bug repro: finds an untagged draft by its tag_name and maps asset names', () => {
    const releases: ReleaseListEntry[] = [
      {
        id: 356461075,
        tag_name: 'v0.8.4',
        draft: true,
        assets: [{ name: 'Sound.Buddy-0.8.4-arm64-mac.zip' }, { name: 'Sound.Buddy-0.8.4-arm64.dmg' }],
      },
    ];
    expect(selectReleaseByTag(releases, 'v0.8.4')).toEqual({
      id: 356461075,
      isDraft: true,
      assetNames: ['Sound.Buddy-0.8.4-arm64-mac.zip', 'Sound.Buddy-0.8.4-arm64.dmg'],
    });
  });

  it('prefers a published release over a draft with the same tag_name', () => {
    const releases: ReleaseListEntry[] = [
      { id: 1, tag_name: 'v0.8.4', draft: true, assets: [] },
      { id: 2, tag_name: 'v0.8.4', draft: false, assets: [] },
    ];
    const selected = selectReleaseByTag(releases, 'v0.8.4');
    expect(selected).not.toBeNull();
    expect(selected?.id).toBe(2);
    expect(selected?.isDraft).toBe(false);
  });

  it('among duplicate drafts sharing a tag_name, returns the highest id (real v0.8.0 duplicate case, ascending order)', () => {
    const releases: ReleaseListEntry[] = [
      { id: 352647691, tag_name: 'v0.8.0', draft: true, assets: [] },
      { id: 352647975, tag_name: 'v0.8.0', draft: true, assets: [] },
    ];
    expect(selectReleaseByTag(releases, 'v0.8.0')?.id).toBe(352647975);
  });

  it('among duplicate drafts sharing a tag_name, returns the highest id regardless of input order (descending order)', () => {
    const releases: ReleaseListEntry[] = [
      { id: 352647975, tag_name: 'v0.8.0', draft: true, assets: [] },
      { id: 352647691, tag_name: 'v0.8.0', draft: true, assets: [] },
    ];
    expect(selectReleaseByTag(releases, 'v0.8.0')?.id).toBe(352647975);
  });

  it('maps assets: [] to assetNames: []', () => {
    const releases: ReleaseListEntry[] = [{ id: 1, tag_name: 'v0.8.4', draft: true, assets: [] }];
    expect(selectReleaseByTag(releases, 'v0.8.4')?.assetNames).toEqual([]);
  });
});

describe('auditReleaseScriptResolution', () => {
  it('flags a tag-resolved gh release upload with the 1-indexed line number and offending subcommand', () => {
    const script = 'line one\ngh release upload "$TAG" "$MANIFEST_PATH" -R "$PUBLIC_REPO" --clobber\n';
    const result = auditReleaseScriptResolution(script);
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('line 2');
    expect(result.problems[0]).toContain('gh release upload');
  });

  it('flags a tag-resolved gh release download', () => {
    const script = 'gh release download "$TAG" -R "$PUBLIC_REPO" --pattern "$ZIP_ASSET_NAME" -O -\n';
    const result = auditReleaseScriptResolution(script);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('gh release download');
  });

  it('flags gh release view', () => {
    const result = auditReleaseScriptResolution('gh release view "$TAG" -R "$PUBLIC_REPO"\n');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('gh release view');
  });

  it('flags gh release edit', () => {
    const result = auditReleaseScriptResolution('gh release edit "$TAG" -R "$PUBLIC_REPO" --draft=false\n');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('gh release edit');
  });

  it('does not flag gh release create', () => {
    const result = auditReleaseScriptResolution('gh release create "$TAG" "$ZIP" "$DMG" -R "$PUBLIC_REPO" --draft\n');
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('does not flag id-keyed gh api calls or prose without the "gh release <sub>" shape', () => {
    const script = [
      'gh api "repos/$PUBLIC_REPO/releases/$RELEASE_ID" --jq .assets',
      '# see the release notes for details',
      'gh api -X PATCH "repos/$PUBLIC_REPO/releases/$RELEASE_ID" -F draft=false --silent',
    ].join('\n');
    const result = auditReleaseScriptResolution(script);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('a clean script returns ok: true, problems: []', () => {
    expect(auditReleaseScriptResolution('#!/usr/bin/env bash\nset -euo pipefail\n')).toEqual({ ok: true, problems: [] });
  });
});

const releaseScriptPath = fileURLToPath(new URL('../../../scripts/release.sh', import.meta.url));
const hasReleaseScript = existsSync(releaseScriptPath);

describe.runIf(hasReleaseScript)('the real scripts/release.sh (#648)', () => {
  it('contains no tag-resolved gh release subcommands', () => {
    const script = readFileSync(releaseScriptPath, 'utf8');
    const result = auditReleaseScriptResolution(script);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('contains no local build/create/upload/promote and waits on the tagged CI run (#1239)', () => {
    const script = readFileSync(releaseScriptPath, 'utf8');
    const result = auditLocalReleaseScript(script);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(script).not.toContain('npm run dist');
    expect(script).toContain('verifyPublishedRelease');
  });
});
