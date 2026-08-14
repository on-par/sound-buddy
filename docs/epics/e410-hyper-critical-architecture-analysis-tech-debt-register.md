# e410 Hyper-Critical Architecture Analysis 2026-07-14 — Tech Debt Register: completion record

Issue #410 is a tracking epic, not a feature: on 2026-07-14 a hyper-critical architectural
analysis of the Sound Buddy repo produced an overall score of 37/70 and identified 15 tech
debt items (TD-001 through TD-015). The epic's deliverable is the register and prioritization
of those items — not any TD fix (the issue's Out-of-scope section defers each item to its own
tracking issue). The register already lived in the epic's issue body; this record is the
repo-homed, navigable register and the epic's closing evidence, per ADR-0018. This document
verifies, from this checkout, that **all 15 TD items are tracked and linked, 14 of the 15
tracking issues (#396–#409) shipped as squash-merged PRs and are closed `COMPLETED` on GitHub,
and TD-001 (#395) remains `OPEN` by design and out of this epic's scope** — so the epic's
acceptance criteria are met by accumulated work, with no residual code to build.

## The tech debt register

Titles and severities are the epic's verbatim shortenings (the epic body's In-scope list);
the actual GitHub issue titles are shown under each row's linked issue. State is as of
2026-08-14, read from `gh issue view`. Closing PR hashes are the squash-merge commits
reproduced from this checkout's history by the git command in the Verification section.

| TD | Title | Severity | Tracking issue | P-tier | State (2026-08-14) | Closing PR (hash) |
|----|-------|----------|----------------|--------|--------------------|-------------------|
| TD-001 | Kill inline-app.js | Critical | [#395](https://github.com/on-par/sound-buddy/issues/395) | P1 | OPEN | — |
| TD-002 | App not a real package consumer | High | [#396](https://github.com/on-par/sound-buddy/issues/396) | P1 | CLOSED/COMPLETED | [#443](https://github.com/on-par/sound-buddy/pull/443) (`19ae24e`) |
| TD-003 | Split library API from CLI | High | [#397](https://github.com/on-par/sound-buddy/issues/397) | P2 | CLOSED/COMPLETED | [#435](https://github.com/on-par/sound-buddy/pull/435) (`5f993d3`) |
| TD-004 | Unify AI narrative stacks | High | [#398](https://github.com/on-par/sound-buddy/issues/398) | P2 | CLOSED/COMPLETED | [#568](https://github.com/on-par/sound-buddy/pull/568) (`23b4ac3`) |
| TD-005 | DRY band metadata | Medium | [#399](https://github.com/on-par/sound-buddy/issues/399) | P2 | CLOSED/COMPLETED | [#418](https://github.com/on-par/sound-buddy/pull/418) (`ec72031`) |
| TD-006 | Isomorphic license policy | Medium | [#400](https://github.com/on-par/sound-buddy/issues/400) | P2 | CLOSED/COMPLETED | [#432](https://github.com/on-par/sound-buddy/pull/432) (`80014d9`) |
| TD-007 | App coverage floors too low | High | [#401](https://github.com/on-par/sound-buddy/issues/401) | P1 | CLOSED/COMPLETED | [#572](https://github.com/on-par/sound-buddy/pull/572) (`1828137`) |
| TD-008 | No CI e2e | High | [#402](https://github.com/on-par/sound-buddy/issues/402) | P0 | CLOSED/COMPLETED | [#436](https://github.com/on-par/sound-buddy/pull/436) (`039a4df`) |
| TD-009 | Pin "latest" deps | Medium | [#403](https://github.com/on-par/sound-buddy/issues/403) | P0 | CLOSED/COMPLETED | [#412](https://github.com/on-par/sound-buddy/pull/412) (`88e3ff2`) |
| TD-010 | IPC reimplements analyzeAudio | Medium | [#404](https://github.com/on-par/sound-buddy/issues/404) | P3 | CLOSED/COMPLETED | [#433](https://github.com/on-par/sound-buddy/pull/433) (`31b76e5`) |
| TD-011 | Fat SoundBuddyApi | Medium | [#405](https://github.com/on-par/sound-buddy/issues/405) | P3 | CLOSED/COMPLETED | [#434](https://github.com/on-par/sound-buddy/pull/434) (`7d00bcb`) |
| TD-012 | Duplicate sha256Hex | Low | [#406](https://github.com/on-par/sound-buddy/issues/406) | P0 | CLOSED/COMPLETED | [#416](https://github.com/on-par/sound-buddy/pull/416) (`58c7187`) |
| TD-013 | Grading vs report dual judgment | Medium | [#407](https://github.com/on-par/sound-buddy/issues/407) | P2 | CLOSED/COMPLETED | [#437](https://github.com/on-par/sound-buddy/pull/437) (`4da1227`) |
| TD-014 | Required secrets check | Medium | [#408](https://github.com/on-par/sound-buddy/issues/408) | P3 | CLOSED/COMPLETED | [#575](https://github.com/on-par/sound-buddy/pull/575) (`5d4eb55`) |
| TD-015 | Anemic packages/shared | Low | [#409](https://github.com/on-par/sound-buddy/issues/409) | — | CLOSED/COMPLETED | [#430](https://github.com/on-par/sound-buddy/pull/430) (`5922f45`) |

## Prioritized action plan

The epic's tiers, reproduced verbatim from the issue body. Work on the linked issues was
sequenced by these tiers; 13 of the 14 tiered items shipped (see the discrepancies note for
TD-001/TD-015).

- **P0 — stop the bleeding:** #403 (TD-009), #406 (TD-012), #402 (TD-008)
- **P1 — finish the migration:** #395 (TD-001), #401 (TD-007), #396 (TD-002)
- **P2 — collapse parallel systems:** #397 (TD-003), #398 (TD-004), #399 (TD-005), #400 (TD-006), #407 (TD-013)
- **P3 — API polish:** #405 (TD-011), #404 (TD-010), #408 (TD-014)

## Baseline score matrix

The 2026-07-14 analysis scored the repo **37/70 overall** — rated **D+ as clean architecture,
B- as a shipping product** — across seven categories. These figures are the epic's preserved
baseline, transcribed from the issue body (the source report itself is not checked into this
repo; see the discrepancies note):

| Category | Score |
|----------|-------|
| Monorepo & Vertical Slice | 5/10 |
| SOLID Principles | 4/10 |
| Pragmatic Programmer | 5/10 |
| Martin Fowler Refactoring | 4/10 |
| Coding Standards & TS | 6/10 |
| Testing Architecture | 6/10 |
| CI/CD & DevOps | 7/10 |
| **Overall** | **37/70** |

## Discrepancies documented, not smoothed over

Mirroring e383's "Transcript swap note", three gaps in the source are recorded here instead of
being papered over:

- **TD-015 (#409) carries no P-tier.** The epic's action plan lists 14 of the 15 issues —
  TD-015 is omitted — so no tier "matches the analysis" and none is invented here. The item is
  Low severity and shipped regardless via PR #430 (`5922f45`); the register records it as
  un-tiered.
- **The source report is not in the repo.** `sound-buddy-arch-analysis-2026-07-14.md` is
  referenced by the epic but is not checked into this repository (verified by tree search). The
  epic body is therefore the in-repo authority for the register; the report remains the
  full-findings source, referenced by name.
- **TD-001 (#395) remains OPEN.** The epic's scope explicitly excludes implementing TD fixes
  ("each debt item is tracked and worked through its own issue"). Closing #410 therefore does
  not close #395 — it stays OPEN and tracked by its own issue.

## Acceptance-criteria checklist

Each epic criterion is asserted from this checkout with its evidence.

- [x] **The tech debt register captures all 15 items (TD-001 through TD-015) with severity,
      tracking issue number, and assigned priority tier (P0/P1/P2/P3) matching the analysis.**
      The register table above lists all 15 rows; severities and tiers match the epic body's
      In-scope list and P0–P3 plan verbatim. The one intentional gap — TD-015's missing tier —
      is the epic's own and is recorded as a discrepancy, not filled in.
- [x] **Each TD item's tracking issue is linked from this epic so the register is navigable.**
      Every row links its tracking issue (#395–#409) inline; each `#NNN` resolves to the TD
      title shown (verified via `gh issue view`).
- [x] **The prioritized action plan (P0–P3) is recorded and used to sequence work on the
      linked issues.** Reproduced verbatim above; 13 of the 14 tiered items shipped via the
      closing PRs in the register.
- [x] **The 7 category scores and the overall 37/70 score are preserved in this epic as the
      2026-07-14 baseline.** Recorded in the baseline score matrix above, matching the epic
      body's In-scope list exactly.
- [x] **This epic references the source report `sound-buddy-arch-analysis-2026-07-14.md` for
      full findings.** The epic body names it; this record references it by name and documents
      that it is not checked into the repo.
- [x] **No implementation work is scheduled in this epic beyond the register and
      prioritization.** The diff is a single markdown completion record; no product code,
      tests, package manifests, coverage thresholds, or CI configuration change. TD-001 (#395)
      stays OPEN on its own issue and is not closed by anything here.

## Verification

Run from this checkout (all green as of 2026-08-14):

- `git log --all --oneline | grep -E '\(#(443|435|568|418|432|572|436|412|433|434|416|437|575|430)\)'`
  — reproduces all 14 merged closing-PR hashes cited above: `19ae24e`, `5f993d3`, `23b4ac3`,
  `ec72031`, `80014d9`, `1828137`, `039a4df`, `88e3ff2`, `31b76e5`, `7d00bcb`, `58c7187`,
  `4da1227`, `5d4eb55`, `5922f45`.
- `git merge-base --is-ancestor <hash> HEAD` for each of the 14 hashes above — all report
  ancestor-of-HEAD, proving each squash-merge commit is in this tree's history.
- `gh issue view` on #395–#409 — #395 is `OPEN`; the other fourteen are `CLOSED` with
  `stateReason: COMPLETED`, matching the register's State column exactly.
- `gh issue view 410 --json title,body` — confirms the epic body already contains all fifteen
  `#395`–`#409` references, the P0–P3 plan, and the score matrix — i.e. the register existed in
  the issue before this PR; this PR records and verifies it rather than creating it.
- `./scripts/verify.sh --fast` — passes on the accumulated tree. The diff is doc-only, so
  compile, lint, tests, and the coverage ratchet are untouched.
