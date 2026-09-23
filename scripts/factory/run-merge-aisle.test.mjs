import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIGH_RISK_LABEL } from './merge-aisle.mjs';
import { loadAlertedKeys, runMergeAisle, saveAlertedKeys } from './run-merge-aisle.mjs';

describe('loadAlertedKeys / saveAlertedKeys', () => {
  let dir;
  let stateFile;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'merge-aisle-'));
    stateFile = join(dir, 'alerts.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty set when the state file does not exist yet', async () => {
    const keys = await loadAlertedKeys(stateFile);
    expect(keys).toEqual(new Set());
  });

  it('round-trips a saved set of keys', async () => {
    await saveAlertedKeys(stateFile, new Set(['2:sha2', '1:sha1']));
    const keys = await loadAlertedKeys(stateFile);
    expect(keys).toEqual(new Set(['1:sha1', '2:sha2']));
  });

  it('saves the keys sorted, for stable diffs', async () => {
    await saveAlertedKeys(stateFile, new Set(['2:sha2', '1:sha1']));
    const raw = await readFile(stateFile, 'utf8');
    expect(JSON.parse(raw)).toEqual(['1:sha1', '2:sha2']);
  });

  it('treats a non-array state file as an empty set', async () => {
    await writeFile(stateFile, JSON.stringify({ not: 'an array' }), 'utf8');
    const keys = await loadAlertedKeys(stateFile);
    expect(keys).toEqual(new Set());
  });

  it('propagates a non-ENOENT read error', async () => {
    // A directory can't be read as a file — forces a non-ENOENT fs error.
    await expect(loadAlertedKeys(dir)).rejects.toThrow();
  });
});

function makeGreenPr(overrides = {}) {
  const completedAt = '2026-09-23T09:00:00.000Z';
  return {
    number: 1,
    headSha: 'sha1',
    isDraft: false,
    mergeable: true,
    labels: [],
    files: ['docs/README.md'],
    checks: ['ci', 'e2e', 'site', 'worker', 'secrets'].map((name) => ({
      name,
      conclusion: 'SUCCESS',
      completedAt,
    })),
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    fetchOpenPrs: vi.fn(async () => []),
    readAlertedKeys: vi.fn(async () => new Set()),
    writeAlertedKeys: vi.fn(async () => {}),
    mergePr: vi.fn(async () => {}),
    labelPr: vi.fn(async () => {}),
    commentOnPr: vi.fn(async () => {}),
    now: Date.parse('2026-09-23T09:05:00.000Z'),
    alertThresholdMinutes: 20,
    log: vi.fn(),
    ...overrides,
  };
}

describe('runMergeAisle', () => {
  it('merges a low-risk green PR and persists the (empty) alerted-key set', async () => {
    const deps = makeDeps({ fetchOpenPrs: vi.fn(async () => [makeGreenPr()]) });
    const { actions } = await runMergeAisle(deps);

    expect(actions).toContainEqual({ type: 'merge', number: 1, headSha: 'sha1' });
    expect(deps.mergePr).toHaveBeenCalledWith(1);
    expect(deps.labelPr).not.toHaveBeenCalled();
    expect(deps.commentOnPr).not.toHaveBeenCalled();
    expect(deps.writeAlertedKeys).toHaveBeenCalledWith(new Set());
  });

  it('labels a high-risk green PR instead of merging', async () => {
    const pr = makeGreenPr({ files: ['package.json'] });
    const deps = makeDeps({ fetchOpenPrs: vi.fn(async () => [pr]) });
    await runMergeAisle(deps);

    expect(deps.labelPr).toHaveBeenCalledWith(1, HIGH_RISK_LABEL);
    expect(deps.mergePr).not.toHaveBeenCalled();
  });

  it('comments an alert on a PR idle past the threshold and saves the new alerted key', async () => {
    const pr = makeGreenPr({ files: ['package.json'] });
    const deps = makeDeps({
      fetchOpenPrs: vi.fn(async () => [pr]),
      now: Date.parse('2026-09-23T09:30:00.000Z'), // 30 min after green
      alertThresholdMinutes: 20,
    });
    await runMergeAisle(deps);

    expect(deps.commentOnPr).toHaveBeenCalledTimes(1);
    const [number, body] = deps.commentOnPr.mock.calls[0];
    expect(number).toBe(1);
    expect(body).toMatch(/30 min/);
    expect(deps.writeAlertedKeys).toHaveBeenCalledWith(new Set(['1:sha1']));
  });

  it('dry-run logs every action but performs no side effects and does not persist state', async () => {
    const pr = makeGreenPr({ files: ['package.json'] });
    const deps = makeDeps({
      fetchOpenPrs: vi.fn(async () => [pr]),
      now: Date.parse('2026-09-23T09:30:00.000Z'),
      dryRun: true,
    });
    await runMergeAisle(deps);

    expect(deps.mergePr).not.toHaveBeenCalled();
    expect(deps.labelPr).not.toHaveBeenCalled();
    expect(deps.commentOnPr).not.toHaveBeenCalled();
    expect(deps.writeAlertedKeys).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalled();
    expect(deps.log.mock.calls.some(([line]) => line.startsWith('[dry-run] '))).toBe(true);
  });

  it('skips a PR that is not green and takes no action for it', async () => {
    const pr = makeGreenPr({ checks: [] });
    const deps = makeDeps({ fetchOpenPrs: vi.fn(async () => [pr]) });
    const { actions } = await runMergeAisle(deps);

    expect(actions).toEqual([{ type: 'skip', number: 1, reason: 'not-green' }]);
    expect(deps.mergePr).not.toHaveBeenCalled();
    expect(deps.labelPr).not.toHaveBeenCalled();
    expect(deps.commentOnPr).not.toHaveBeenCalled();
  });

  it('uses a real Date.now() and a no-op log by default', async () => {
    const deps = makeDeps({ fetchOpenPrs: vi.fn(async () => [makeGreenPr()]) });
    delete deps.now;
    delete deps.log;
    const { actions } = await runMergeAisle(deps);
    expect(actions).toContainEqual({ type: 'merge', number: 1, headSha: 'sha1' });
    expect(deps.mergePr).toHaveBeenCalledWith(1);
  });
});
