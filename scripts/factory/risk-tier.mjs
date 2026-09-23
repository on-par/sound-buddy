// Deny-by-default risk classification for factory PRs (#1503). A PR is
// `low` only when every changed path matches a `low` rule; any unmatched
// path, or any path matching a `high` rule, makes the whole PR `high`. High
// rules are listed first and win ties, so a PR that touches both a doc and
// the mixer/console code is high, not low.
//
// Every id here must also appear in scripts/factory/README.md — see the
// drift test in risk-tier.test.mjs — so the tier rules stay documented for
// whoever reads a factory PR's classification later.
export const RISK_RULES = [
  // --- high: checked first, any match forces the whole PR high ---
  {
    id: 'dependencies',
    tier: 'high',
    test: (path) => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/.test(path),
  },
  {
    id: 'mixer-console',
    tier: 'high',
    test: (path) => /^packages\/scene-inspector\//.test(path) || /^packages\/console\//.test(path),
  },
  {
    id: 'live-audio',
    tier: 'high',
    test: (path) =>
      /^packages\/audio-engine\//.test(path) || /^app\/electron\/(ipc\/)?.*(capture|live)/i.test(path),
  },
  {
    id: 'release-packaging',
    tier: 'high',
    test: (path) =>
      /^scripts\/release\.sh$/.test(path) ||
      /^scripts\/ci-.*\.mjs$/.test(path) ||
      /^app\/build\//.test(path) ||
      /^\.github\/workflows\/release\.yml$/.test(path) ||
      /^docs\/signing-and-notarization\.md$/.test(path),
  },
  {
    id: 'licensing',
    tier: 'high',
    test: (path) => /^app\/electron\/license/.test(path) || /^worker\//.test(path),
  },
  {
    id: 'factory-automation',
    tier: 'high',
    test: (path) => /^scripts\/factory\//.test(path) || /^\.factory\//.test(path),
  },

  // --- low: only reached when no high rule matched ---
  {
    id: 'docs-only',
    tier: 'low',
    test: (path) => /^docs\//.test(path) || /^[^/]+\.md$/.test(path),
  },
  {
    id: 'test-only',
    tier: 'low',
    test: (path) => /\.test\.(ts|tsx|mjs|js)$/.test(path) || /^app\/tests\/e2e\//.test(path),
  },
  {
    id: 'ui-polish',
    tier: 'low',
    test: (path) => /^app\/renderer\/.*\.(css|scss)$/.test(path),
  },
];

function tierForPath(path) {
  for (const rule of RISK_RULES) {
    if (rule.test(path)) return rule.tier;
  }
  return 'high';
}

export function classifyRiskTier(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return 'high';
  return paths.every((path) => tierForPath(path) === 'low') ? 'low' : 'high';
}
