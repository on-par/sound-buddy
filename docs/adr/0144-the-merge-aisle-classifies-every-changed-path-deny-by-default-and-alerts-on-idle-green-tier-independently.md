# The merge aisle classifies every changed path deny-by-default, and alerts on an idle-green PR tier-independently

- Status: Accepted
- Date: 2026-09-23

## Context

#1503 (parent: on-par/software-factory#1659, Factory Throughput & Merge Hygiene): green
factory PRs were sitting in await-merge with no human click scheduled — #1500 (the
ideal-curve overlay) sat CI-green and unmerged for hours purely because nobody happened to
look. The obvious fix, `gh pr merge --auto`, is unavailable: `gh api repos/on-par/sound-buddy`
reports `allow_auto_merge: false`, and that's a repository *setting*, not part of
`.github/rulesets/main.json` — no PR merged through this repo can turn it on, so an
acceptance criterion rekying on it would be unprovable from inside the repo.

The issue calls for *risk-tiered* auto-merge: low-risk PRs (docs, tests, UI polish) merge
without a human; high-risk ones (mixer, console, live-audio, release, licensing) still wait.
Two design questions had to be settled up front. First, what happens to a path the rule table
has never seen — a new top-level directory, a renamed package. Second, whether the
idle-green alert should only fire for the high tier (the PRs actually waiting on a human) or
for both.

## Decision

`scripts/factory/risk-tier.mjs` exports an ordered `RISK_RULES` list — every `high` rule
before every `low` rule — and `classifyRiskTier(paths)`, which returns `low` only when
`paths` is non-empty and *every* path matches a `low` rule. A path matching no rule, or any
path matching a `high` rule, makes the whole PR `high`. This is **deny-by-default**: an
unrecognized path (new directory, renamed package, anything the table hasn't been taught
yet) is high-risk until someone adds a rule for it, not low-risk by omission. The rule table
itself — ids, tiers, and what each matches — is documented in
`scripts/factory/README.md`, not `docs/`, because `docs/README.md` restricts that folder to
ADRs, security analyses, and the design reference; a drift test in `risk-tier.test.mjs`
asserts every `RISK_RULES` id string appears in the README so the two can't quietly diverge.
One consequence worth naming: the `dependencies` rule (`package.json` / `package-lock.json`)
is high, so this PR itself — which adds `scripts/factory/**` (also its own `high` rule,
`factory-automation`) and a `package.json` script entry — classifies high and would not have
self-merged.

`scripts/factory/merge-aisle.mjs` holds the pure decision layer: `greenSinceMs(checks)`
walks the five required contexts from `.github/rulesets/main.json` (`ci`, `e2e`, `site`,
`worker`, `secrets`) and returns the moment the last one succeeded, or `null` if any is
missing or non-passing. `decideMergeAisleActions({ prs, now, alertedKeys,
alertThresholdMinutes })` is a straight reducer with no I/O: for each green PR, `low` tier
emits `merge` (mergeable, non-draft only), `high` tier emits `label` (once —
`risk:high-manual-merge`) so a human sees it needs a click. Independently of tier, a PR green
for at least `alertThresholdMinutes` gets an `alert` action — **tier-independently**, so a
low-risk PR whose merge keeps failing (a stale head, a flaked required check) still surfaces
instead of rotting silently behind "it's low-risk, it'll sort itself out." Alerts are keyed on
`${number}:${headSha}` in a set pruned to still-open PRs each run, so one alert per green
instance of a PR — a new push re-arms it, closing/merging the PR drops it — never a repeat
spam loop. The alert itself is a `gh pr comment`, not a new webhook or secret: it lands in the
GitHub notifications Patrick already watches.

Since `gh pr merge --auto` is off the table, `scripts/factory/run-merge-aisle.mjs` executes
the `merge` action as `gh pr merge --squash --delete-branch` directly — going through the same
five required checks a human clicking the button would have to clear, just without the click.
Every side effect (`gh`, the alerted-keys state file at
`.factory/state/merge-aisle-alerts.json`) is injected, so `runMergeAisle()` is fully unit
tested; only the CLI entrypoint (argv parsing, the real `gh`/fs bindings) is `/* c8 ignore */`d.
`scripts/**` had no vitest project before this PR (and is outside `eslint.config.mjs`'s
TypeScript lint by design), so new code there was previously silently untested — a
`scripts/vitest.config.mts` project, added to the root `vitest.config.ts` projects list, closes
that gap. `coverage.include` at the root is deliberately left untouched: `scripts/` was never
counted there, so no floor moves in either direction, while the new suite genuinely runs (and
must pass) under `npm test`.

## Consequences

Positive: a low-risk green PR merges without waiting on a human to notice it; a high-risk one
still requires a click, now visibly labeled instead of silently sitting in the PR list; and any
PR — regardless of tier — that stays green and unmerged past the threshold surfaces once,
instead of never. The classifier fails closed on anything it doesn't recognize, so a
directory-structure change or a new package can't accidentally start auto-merging until a rule
is written for it on purpose. The whole decision path is pure and unit-tested at 100%
statement/branch/function/line coverage for the three new modules, with no `gh` or network
access required to prove it.

Negative: the deny-by-default table needs upkeep — a genuinely low-risk area that isn't yet
covered by a `low` rule stays high (safe but slower) until someone adds it, and the inverse
mistake (a `low` rule drawn too broadly) is a real failure mode this design doesn't
structurally prevent, only documents and tests against known cases. `dependencies` classifying
high means the throughput win here is smaller than a blocklist-style "auto-merge unless
touching X" approach would give — dependabot PRs, and PRs like this one, always wait for a
human. Installing the LaunchAgent that runs `run-merge-aisle.mjs` on a timer is a manual,
machine-local step (documented in `scripts/factory/README.md`'s "what is still manual"
section, ADR-0127's format) — it can't be done from a PR, and confirming it survives a reboot
can only be verified by rebooting the machine that runs it.

## References

- [Issue #1503](https://github.com/on-par/sound-buddy/issues/1503)
- [Parent: on-par/software-factory#1659 — Factory Throughput & Merge Hygiene](https://github.com/on-par/software-factory/issues/1659)
- [ADR-0127 — A visual-verification result record carries no open pending cells; sign-off is attributed and residual manual work is scoped separately](0127-a-visual-verification-result-record-carries-no-open-pending-cells-sign-off-is-attributed-and-residual-manual-work-is-scoped-separately.md)
- [scripts/factory/README.md — risk-tier rules and the merge-aisle runbook](../../scripts/factory/README.md)
