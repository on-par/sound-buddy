# Factory merge aisle

Runbook for the risk-tiered auto-merge and idle-green-PR alert described in issue #1503.
This is where the mechanism is documented per CLAUDE.md's `docs/README.md` restriction
(ADRs / security analyses / design reference only) — everything about the merge-aisle
scripts belongs here instead.

`docs/` is off-limits for this kind of runbook, so this file is the source of truth
`RISK_RULES` (`risk-tier.mjs`) is checked against — every rule id below must appear here,
or `risk-tier.test.mjs`'s drift test fails.

## Risk tiers

Deny-by-default: a PR is `low` only when every changed path matches a `low` rule below. Any
path that matches no rule, or matches a `high` rule, makes the *whole* PR `high`. High rules
are checked first, so a PR that mixes a low-risk path with a high-risk one is always `high`.

| id | tier | matches |
| --- | --- | --- |
| `dependencies` | high | `package.json`, `package-lock.json`, `npm-shrinkwrap.json` anywhere in the tree |
| `mixer-console` | high | `packages/scene-inspector/**`, `packages/console/**` |
| `live-audio` | high | `packages/audio-engine/**`, `app/electron/**capture**` / `**live**` (case-insensitive) |
| `release-packaging` | high | `scripts/release.sh`, `scripts/ci-*.mjs`, `app/build/**`, `.github/workflows/release.yml`, `docs/signing-and-notarization.md` |
| `licensing` | high | `app/electron/license*`, `worker/**` |
| `factory-automation` | high | `scripts/factory/**`, `.factory/**` (this mechanism, and factory state, are never self-merging) |
| `docs-only` | low | `docs/**`, any root-level `*.md` |
| `test-only` | low | `**/*.test.{ts,tsx,mjs,js}`, `app/tests/e2e/**` |
| `ui-polish` | low | `app/renderer/**/*.css`, `app/renderer/**/*.scss` |

A dependabot PR (or this PR, which edits `package.json`) always classifies `dependencies` →
`high` and waits for a human. That's deliberate: the throughput win here is smaller than a
blocklist would give, in exchange for never auto-merging a dependency bump unreviewed.

## Merge decision

`decideMergeAisleActions()` (`merge-aisle.mjs`) is a pure reducer. For every open PR:

1. `greenSinceMs()` checks the five required checks from
   `.github/rulesets/main.json` — `ci`, `e2e`, `site`, `worker`, `secrets` —
   and returns when the PR *became* green (the latest `completedAt` among
   them), or `null` if it isn't green yet. Not green → `skip`, no alert.
2. Green + tier `low` + not a draft + GitHub reports it mergeable → `merge`
   (this repo's `allow_auto_merge` is `false`, so `gh pr merge --auto` can't
   be armed; the sweeper merges directly, through the same required checks a
   human click would go through).
3. Green + tier `high` and not already labeled → `label` with
   `risk:high-manual-merge`, so it's visible as needing a human click.
4. Green and idle ≥ the alert threshold (default 20 minutes) and not already
   alerted for this exact `${number}:${headSha}` → `alert`. This fires
   **tier-independently**: a low-risk PR whose merge keeps failing still
   surfaces instead of rotting silently. Alerting is keyed on
   `number:headSha` so a new push re-arms it instead of permanently
   silencing that PR after one alert, and the key set is pruned to PRs that
   are still open.
