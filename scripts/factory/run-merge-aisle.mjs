// Orchestrates the merge aisle (#1503): fetch open factory PRs' current
// state via `gh`, decide actions with the pure reducer in merge-aisle.mjs,
// and execute them. Every side effect is injected so `runMergeAisle` itself
// is fully unit-testable; only the CLI entrypoint below (argv parsing, the
// real gh/fs bindings) is exercised by hand / by the LaunchAgent, so it's
// c8-ignored per CLAUDE.md's Standards (Electron/CLI wiring exemption).
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decideMergeAisleActions } from './merge-aisle.mjs';

export const DEFAULT_ALERT_THRESHOLD_MINUTES = 20;
export const DEFAULT_STATE_FILE = fileURLToPath(
  new URL('../../.factory/state/merge-aisle-alerts.json', import.meta.url),
);

export async function loadAlertedKeys(stateFile) {
  try {
    const raw = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw err;
  }
}

export async function saveAlertedKeys(stateFile, alertedKeys) {
  await writeFile(stateFile, JSON.stringify([...alertedKeys].sort(), null, 2) + '\n', 'utf8');
}

export async function runMergeAisle({
  fetchOpenPrs,
  readAlertedKeys,
  writeAlertedKeys,
  mergePr,
  labelPr,
  commentOnPr,
  now = Date.now(),
  alertThresholdMinutes = DEFAULT_ALERT_THRESHOLD_MINUTES,
  dryRun = false,
  log = () => {},
}) {
  const [prs, alertedKeys] = await Promise.all([fetchOpenPrs(), readAlertedKeys()]);
  const { actions, alertedKeys: nextAlertedKeys } = decideMergeAisleActions({
    prs,
    now,
    alertedKeys,
    alertThresholdMinutes,
  });

  for (const action of actions) {
    log(`${dryRun ? '[dry-run] ' : ''}${JSON.stringify(action)}`);
    if (dryRun) continue;

    switch (action.type) {
      case 'merge':
        await mergePr(action.number);
        break;
      case 'label':
        await labelPr(action.number, action.label);
        break;
      case 'alert':
        await commentOnPr(
          action.number,
          `⏰ Merge aisle: this PR has been CI-green for ${Math.round(action.minutesGreen)} min ` +
            `without merging (risk tier: ${action.tier}).`,
        );
        break;
      case 'skip':
        break;
    }
  }

  if (!dryRun) await writeAlertedKeys(nextAlertedKeys);

  return { actions };
}

/* c8 ignore start -- CLI entrypoint: argv parsing plus the real gh/fs bindings; run by hand or by the LaunchAgent, not unit-testable without gh and network access (see runMergeAisle's tests for the covered decision logic) */
const REPO = 'on-par/sound-buddy';

function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

async function fetchOpenPrsFromGh() {
  const raw = ghJson([
    'pr',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--json',
    'number,headRefOid,isDraft,mergeable,labels,files,statusCheckRollup',
  ]);
  return raw.map((pr) => ({
    number: pr.number,
    headSha: pr.headRefOid,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable === 'MERGEABLE',
    labels: pr.labels.map((l) => l.name),
    files: pr.files.map((f) => f.path),
    checks: (pr.statusCheckRollup ?? []).map((c) => ({
      name: c.name,
      conclusion: c.conclusion,
      completedAt: c.completedAt,
    })),
  }));
}

async function mergePrViaGh(number) {
  execFileSync('gh', ['pr', 'merge', String(number), '--repo', REPO, '--squash', '--delete-branch']);
}

async function labelPrViaGh(number, label) {
  execFileSync('gh', ['pr', 'edit', String(number), '--repo', REPO, '--add-label', label]);
}

async function commentOnPrViaGh(number, body) {
  execFileSync('gh', ['pr', 'comment', String(number), '--repo', REPO, '--body', body]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const thresholdFlag = argv.find((a) => a.startsWith('--alert-threshold-minutes='));
  const alertThresholdMinutes = thresholdFlag
    ? Number(thresholdFlag.split('=')[1])
    : DEFAULT_ALERT_THRESHOLD_MINUTES;

  await runMergeAisle({
    fetchOpenPrs: fetchOpenPrsFromGh,
    readAlertedKeys: () => loadAlertedKeys(DEFAULT_STATE_FILE),
    writeAlertedKeys: (keys) => saveAlertedKeys(DEFAULT_STATE_FILE, keys),
    mergePr: mergePrViaGh,
    labelPr: labelPrViaGh,
    commentOnPr: commentOnPrViaGh,
    alertThresholdMinutes,
    dryRun,
    log: (line) => console.log(line),
  });
}
/* c8 ignore stop */
