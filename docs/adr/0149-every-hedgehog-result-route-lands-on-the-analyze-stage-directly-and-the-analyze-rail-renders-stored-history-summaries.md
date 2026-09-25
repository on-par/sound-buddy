# Every hedgehog result route lands on the Analyze stage directly, and the Analyze rail renders stored History summaries

- Status: Accepted
- Date: 2026-09-25

## Context

The 2026-09-25 packaging lock (#1518) makes Analyze the one place a FOH volunteer sees a grade and named fixes.
The Report Card peer tab is gone from the nav (#1507, #1512), and ADR-0148 keeps the old Report Card workspace
only as an env-flagged, default-off dev surface. But History row clicks, onboarding's first run and File > Open
still called switchMode('reportcard'). They reached Analyze only by accident, through the flag gate's redirect,
and the Analyze rail could not render a History summary. The result was that a History click in the default
build showed an empty rail. The same routes also behaved differently depending on a dev flag.

## Decision

Every route that exists to show a result to a hedgehog user calls mode-switch.ts's showAnalyzeStage()
directly. That includes loadHistoryEntry, onboardingStore.runFirstAnalysis and the File > Open menu handler,
and it holds whatever the feature flags or Simple/Advanced mode say. None of these routes goes through
switchMode('reportcard') or openReportCard(). analyze-results.ts's analyzeResultsView is the one fold for
what the rail shows. Its priority is currentAnalysis, then liveSource, then historySummary, then empty,
matching ReportCardIsland. A History summary renders its frozen gradeLetter/score and topFixes and is never
re-graded. switchMode('reportcard') / openReportCard() remain only for callers inside flag-gated surfaces
(Session's report-card offer, Build Guide) and the e2e gotoReportCard helper.

## Consequences

Result navigation for users no longer depends on the reportCard flag, and History now shows a real grade
in Analyze. New result-producing entry points must call showAnalyzeStage(). A reviewer should reject a new
switchMode('reportcard') outside a flagged surface. The flag-gated Report Card workspace can no longer
be reached from History, onboarding or File > Open, even with the flag on. Specs that relied on that now
assert the arc-* rail. Fully deleting the Report Card workspace is still a separate, larger slice.

## References

- [Issue #1521 — Remove Report Card tab; Analyze owns results](https://github.com/on-par/sound-buddy/issues/1521)
- [ADR-0145 — Analyze results rail](docs/adr/0145-analyzes-results-rail-is-an-analyzestage-owned-second-column-with-its-own-arc-id-namespace.md)
- [ADR-0148 — feature-flag registry](docs/adr/0148-non-hedgehog-workspaces-sit-behind-an-env-only-feature-flag-registry-default-off-enforced-at-switchmode.md)
