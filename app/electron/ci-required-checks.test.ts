import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards TD-014 (#408): the `secrets` (gitleaks) job in
// .github/workflows/ci.yml must stay listed as a required status check in
// .github/rulesets/main.json, the versioned copy of the branch ruleset. This
// keeps a newly added CI job from silently escaping the required-checks gate
// and keeps `secrets` itself from quietly falling out of it. Repo-level
// checks are skipped when app/ is checked out without the surrounding
// monorepo (e.g. an app-only source export), matching threat-model.test.ts
// and licensing.test.ts.
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');
const hasMonorepo = fs.existsSync(path.join(repoRoot, 'packages'));

const CI_YML_PATH = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const RULESET_PATH = path.join(repoRoot, '.github', 'rulesets', 'main.json');

const EXPECTED_JOB_IDS = ['ci', 'e2e', 'site', 'worker', 'secrets'];
const GITHUB_ACTIONS_APP_ID = 15368;

/**
 * Parses top-level job ids out of a GitHub Actions workflow file's `jobs:`
 * block. Two-space indent is the only top-level-job indent in ci.yml, so
 * nested step/key lines (4+ spaces) and top-level workflow keys (`on:`,
 * `name:`, 0 spaces) are excluded without needing a YAML parser.
 */
export function ciJobIds(ciYml: string): string[] {
  const jobsIndex = ciYml.indexOf('\njobs:');
  const fromJobs = jobsIndex === -1 ? ciYml : ciYml.slice(jobsIndex);
  const matches = fromJobs.matchAll(/^ {2}([a-z0-9][a-z0-9_-]*):$/gm);
  return Array.from(matches, (m) => m[1]);
}

describe('ciJobIds', () => {
  it('returns only top-level job ids, excluding nested and 0-indent keys', () => {
    const fixture = [
      'name: CI',
      'on:',
      '  push:',
      '    branches: [main]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '  test:',
      '    needs: build',
      '',
    ].join('\n');
    expect(ciJobIds(fixture)).toEqual(['build', 'test']);
  });
});

describe.runIf(hasMonorepo)('CI required-status-checks ruleset (#408)', () => {
  const ciYml = fs.readFileSync(CI_YML_PATH, 'utf8');
  const jobIds = ciJobIds(ciYml);
  const ruleset = JSON.parse(fs.readFileSync(RULESET_PATH, 'utf8'));
  const requiredChecksRule = ruleset.rules.find(
    (rule: { type: string }) => rule.type === 'required_status_checks'
  );
  const requiredContexts: string[] = requiredChecksRule.parameters.required_status_checks.map(
    (check: { context: string }) => check.context
  );

  it('pins the current ci.yml job set', () => {
    expect(jobIds).toEqual(EXPECTED_JOB_IDS);
  });

  it('lists every ci.yml job as a required check, and vice versa', () => {
    const missing = jobIds.filter((id) => !requiredContexts.includes(id));
    const extra = requiredContexts.filter((context) => !jobIds.includes(context));
    expect(
      missing,
      `CI job(s) ${missing.join(', ')} are not required checks — add them to .github/rulesets/main.json, then re-run scripts/sync-ruleset.sh`
    ).toEqual([]);
    expect(
      extra,
      `required check(s) ${extra.join(', ')} have no matching ci.yml job — remove them from .github/rulesets/main.json`
    ).toEqual([]);
  });

  it('requires the secrets (gitleaks) job specifically', () => {
    expect(
      requiredContexts,
      'secrets is no longer a required check — restore it in .github/rulesets/main.json'
    ).toContain('secrets');
  });

  it('scopes every required check to the GitHub Actions app, so no third-party app can post a green status', () => {
    for (const check of requiredChecksRule.parameters.required_status_checks) {
      expect(
        check.integration_id,
        `required check "${check.context}" must be scoped to integration_id ${GITHUB_ACTIONS_APP_ID} (GitHub Actions)`
      ).toBe(GITHUB_ACTIONS_APP_ID);
    }
  });

  it('keeps enforcement active, the deletion/non_fast_forward rules, and the admin bypass actor', () => {
    expect(ruleset.enforcement).toBe('active');
    const ruleTypes = ruleset.rules.map((rule: { type: string }) => rule.type);
    expect(ruleTypes).toContain('deletion');
    expect(ruleTypes).toContain('non_fast_forward');
    expect(ruleset.bypass_actors).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor_type: 'RepositoryRole', bypass_mode: 'always' })])
    );
  });

  it('does not require branches to be up to date with main before merging (would serialize the factory\'s parallel lanes)', () => {
    expect(requiredChecksRule.parameters.strict_required_status_checks_policy).toBe(false);
  });
});
