// Pure decision layer for the merge aisle (#1503): given the open factory
// PRs' current state, decide what to do — merge, label for human attention,
// alert on an idle green PR, or skip. No gh calls, no fs, no clock reads
// beyond the injected `now`; see run-merge-aisle.mjs for the side effects.
import { classifyRiskTier } from './risk-tier.mjs';

// Matches the required status checks in .github/rulesets/main.json — a PR
// isn't "green" until every one of these has succeeded.
export const REQUIRED_CHECKS = ['ci', 'e2e', 'site', 'worker', 'secrets'];

export const HIGH_RISK_LABEL = 'risk:high-manual-merge';

// Returns the epoch-ms timestamp the PR *became* green (the latest
// completedAt among the required checks), or null if it isn't green yet —
// any required check missing, not yet completed, or not a success.
export function greenSinceMs(checks) {
  if (!Array.isArray(checks)) return null;
  const byName = new Map(checks.map((check) => [check.name, check]));
  let latest = -Infinity;
  for (const name of REQUIRED_CHECKS) {
    const check = byName.get(name);
    if (!check || check.conclusion !== 'SUCCESS' || !check.completedAt) return null;
    const completedAt = Date.parse(check.completedAt);
    if (Number.isNaN(completedAt)) return null;
    if (completedAt > latest) latest = completedAt;
  }
  return latest;
}

function alertKey(pr) {
  return `${pr.number}:${pr.headSha}`;
}

// alertedKeys / the returned alertedKeys are Sets of `${number}:${headSha}`
// — keying on headSha means a new push re-arms alerting for that PR instead
// of permanently silencing it after one alert.
export function decideMergeAisleActions({ prs, now, alertedKeys, alertThresholdMinutes }) {
  const currentKeyByNumber = new Map(prs.map((pr) => [pr.number, alertKey(pr)]));
  const nextAlertedKeys = new Set(
    [...alertedKeys].filter((key) => currentKeyByNumber.get(Number(key.split(':')[0])) === key),
  );

  const actions = [];

  for (const pr of prs) {
    const greenSince = greenSinceMs(pr.checks);

    if (greenSince === null) {
      actions.push({ type: 'skip', number: pr.number, reason: 'not-green' });
      continue;
    }

    const tier = classifyRiskTier(pr.files);
    const minutesGreen = (now - greenSince) / 60_000;

    if (tier === 'low') {
      if (!pr.isDraft && pr.mergeable !== false) {
        actions.push({ type: 'merge', number: pr.number, headSha: pr.headSha });
      } else {
        actions.push({ type: 'skip', number: pr.number, reason: 'draft-or-unmergeable' });
      }
    } else if (!pr.labels.includes(HIGH_RISK_LABEL)) {
      actions.push({ type: 'label', number: pr.number, label: HIGH_RISK_LABEL });
    } else {
      actions.push({ type: 'skip', number: pr.number, reason: 'already-labeled' });
    }

    const key = alertKey(pr);
    if (minutesGreen >= alertThresholdMinutes && !nextAlertedKeys.has(key)) {
      actions.push({ type: 'alert', number: pr.number, headSha: pr.headSha, tier, minutesGreen });
      nextAlertedKeys.add(key);
    }
  }

  return { actions, alertedKeys: nextAlertedKeys };
}
