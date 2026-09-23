import { describe, expect, it } from 'vitest';
import {
  HIGH_RISK_LABEL,
  REQUIRED_CHECKS,
  decideMergeAisleActions,
  greenSinceMs,
} from './merge-aisle.mjs';

function allGreenChecks(completedAtByName = {}) {
  return REQUIRED_CHECKS.map((name) => ({
    name,
    conclusion: 'SUCCESS',
    completedAt: completedAtByName[name] ?? '2026-09-23T10:00:00.000Z',
  }));
}

function makePr(overrides = {}) {
  return {
    number: 1,
    headSha: 'sha1',
    isDraft: false,
    mergeable: true,
    labels: [],
    files: ['docs/README.md'],
    checks: allGreenChecks(),
    ...overrides,
  };
}

describe('greenSinceMs', () => {
  it('returns the latest completedAt when every required check succeeded', () => {
    const checks = allGreenChecks({
      ci: '2026-09-23T10:00:00.000Z',
      e2e: '2026-09-23T10:05:00.000Z',
      site: '2026-09-23T10:01:00.000Z',
      worker: '2026-09-23T10:02:00.000Z',
      secrets: '2026-09-23T10:03:00.000Z',
    });
    expect(greenSinceMs(checks)).toBe(Date.parse('2026-09-23T10:05:00.000Z'));
  });

  it('returns null when a required check is missing', () => {
    const checks = allGreenChecks().filter((c) => c.name !== 'e2e');
    expect(greenSinceMs(checks)).toBeNull();
  });

  it('returns null when a required check has not succeeded', () => {
    const checks = allGreenChecks().map((c) => (c.name === 'ci' ? { ...c, conclusion: 'FAILURE' } : c));
    expect(greenSinceMs(checks)).toBeNull();
  });

  it('returns null when a required check has no completedAt yet', () => {
    const checks = allGreenChecks().map((c) => (c.name === 'ci' ? { ...c, completedAt: undefined } : c));
    expect(greenSinceMs(checks)).toBeNull();
  });

  it('returns null for a non-array input', () => {
    expect(greenSinceMs(undefined)).toBeNull();
  });

  it('returns null when completedAt cannot be parsed', () => {
    const checks = allGreenChecks().map((c) => (c.name === 'ci' ? { ...c, completedAt: 'not-a-date' } : c));
    expect(greenSinceMs(checks)).toBeNull();
  });
});

describe('decideMergeAisleActions', () => {
  const now = Date.parse('2026-09-23T10:00:00.000Z');

  it('skips a PR that is not green, without alerting', () => {
    const pr = makePr({ checks: [] });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toEqual([{ type: 'skip', number: 1, reason: 'not-green' }]);
    expect(result.alertedKeys.size).toBe(0);
  });

  it('merges a low-risk, green, mergeable, non-draft PR', () => {
    const pr = makePr({ files: ['docs/README.md'] });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toContainEqual({ type: 'merge', number: 1, headSha: 'sha1' });
  });

  it('skips a low-risk draft PR instead of merging', () => {
    const pr = makePr({ files: ['docs/README.md'], isDraft: true });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toContainEqual({ type: 'skip', number: 1, reason: 'draft-or-unmergeable' });
  });

  it('skips a low-risk PR GitHub reports as unmergeable', () => {
    const pr = makePr({ files: ['docs/README.md'], mergeable: false });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toContainEqual({ type: 'skip', number: 1, reason: 'draft-or-unmergeable' });
  });

  it('labels a high-risk green PR instead of merging', () => {
    const pr = makePr({ files: ['package.json'] });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toContainEqual({ type: 'label', number: 1, label: HIGH_RISK_LABEL });
  });

  it('does not re-label a high-risk PR that already carries the label', () => {
    const pr = makePr({ files: ['package.json'], labels: [HIGH_RISK_LABEL] });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toContainEqual({ type: 'skip', number: 1, reason: 'already-labeled' });
  });

  it('alerts once a green PR has been idle past the threshold', () => {
    const greenAt = '2026-09-23T09:30:00.000Z'; // 30 min before `now`
    const pr = makePr({ files: ['package.json'], checks: allGreenChecks({ ci: greenAt, e2e: greenAt, site: greenAt, worker: greenAt, secrets: greenAt }) });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    const alert = result.actions.find((a) => a.type === 'alert');
    expect(alert).toMatchObject({ type: 'alert', number: 1, headSha: 'sha1', tier: 'high' });
    expect(alert.minutesGreen).toBeCloseTo(30, 5);
    expect(result.alertedKeys.has('1:sha1')).toBe(true);
  });

  it('fires the alert tier-independently for a low-risk PR stuck idle', () => {
    const greenAt = '2026-09-23T09:30:00.000Z';
    const pr = makePr({
      files: ['docs/README.md'],
      checks: allGreenChecks({ ci: greenAt, e2e: greenAt, site: greenAt, worker: greenAt, secrets: greenAt }),
    });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toContainEqual({ type: 'merge', number: 1, headSha: 'sha1' });
    expect(result.actions.some((a) => a.type === 'alert' && a.tier === 'low')).toBe(true);
  });

  it('does not alert twice for the same PR + headSha (no spam loop)', () => {
    const pr = makePr({ files: ['package.json'] });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(['1:sha1']),
      alertThresholdMinutes: 0,
    });
    expect(result.actions.some((a) => a.type === 'alert')).toBe(false);
    expect(result.alertedKeys.has('1:sha1')).toBe(true);
  });

  it('re-arms alerting once the PR gets a new head commit', () => {
    const pr = makePr({ files: ['package.json'], headSha: 'sha2' });
    const result = decideMergeAisleActions({
      prs: [pr],
      now,
      alertedKeys: new Set(['1:sha1']),
      alertThresholdMinutes: 0,
    });
    expect(result.alertedKeys.has('1:sha1')).toBe(false);
    expect(result.actions.some((a) => a.type === 'alert' && a.headSha === 'sha2')).toBe(true);
  });

  it('prunes alerted keys for PRs that are no longer open', () => {
    const result = decideMergeAisleActions({
      prs: [],
      now,
      alertedKeys: new Set(['1:sha1', '2:sha2']),
      alertThresholdMinutes: 20,
    });
    expect(result.actions).toEqual([]);
    expect(result.alertedKeys.size).toBe(0);
  });
});
