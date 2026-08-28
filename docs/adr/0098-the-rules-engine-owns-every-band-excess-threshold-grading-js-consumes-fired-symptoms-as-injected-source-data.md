# The rules engine owns every band-excess threshold; grading.js consumes fired symptoms as injected source data

- Status: Accepted
- Date: 2026-08-28

## Context

Sound Buddy shipped two independent judgments of the same recording. The
letter grade, the score ring and the "Why this grade" deduction list come
from app/renderer/grading.js — a proprietary classic script whose CONFIG
thresholds run over the coarse 7-band src.bands table. The Troubleshooting
section comes from packages/audio-engine/src/analyze/rules.ts's
evaluateRules, an MIT, data-driven RULE_TABLE of band-vs-reference
conditions over the fine SpectrumCurve. #1246 recorded a real card printing
"A, 99/100", "No deductions — this recording met every grading rule" and
"Great job! No major issues detected" directly above "The mix reads as
Muddy: 60-250 Hz sits 8.7 dB above the body". The grade is the product, so
a visible self-contradiction on the flagship screen is a product defect
regardless of test status.

Three constraints shaped the fix. ADR-0027 established that the offline
rules module never imports app renderer code and never reuses grading.js's
constants, and the dual-license structure (guarded by
app/electron/licensing.test.ts) makes a packages/* → app/ dependency
impossible in principle. grading.js is loaded by <script src> in the
renderer and by require() under Vitest, so it has no module loader in the
browser path and cannot import the rules table. And the grade is computed
from ReportCardSource by four separate call sites — ReportCardIsland.tsx,
ReportCardToolbar.tsx, report-card-chrome.ts and report-card.ts's
buildAnalysisSummaryInput — so anything the grade depends on must ride on
the source object or the displayed grade and the persisted history score
will drift apart.

## Decision

packages/audio-engine/src/analyze/rules.ts's RULE_TABLE is the single
definition of every band-excess threshold used to judge tonal balance.
grading.js never declares, copies, or re-derives one.

rules.ts exposes a pure reducer, gradeSymptoms(fired: FiredRule[]):
GradeSymptom[], projecting each fired rule onto its ruleId, symptom,
suggestion instruction, measured excessDb and the rule's own minExcessDb.
app/renderer/src/report-card.ts's reportCardSourceFromAnalysis calls
evaluateRules on the analysis curve and attaches the result as
ReportCardSource.symptoms, so every grade consumer reads the same symptoms
with no call-site change.

grading.js adds exactly one pure helper, symptomDeduction(src), which
returns a single GradeDeduction built from the highest-excess symptom or
null. computeGrade drops one letter when it is non-null, explainGrade
pushes it in the identical guard position, computeScore subtracts the named
SYMPTOM_SCORE_PENALTY, and computeRecommendations emits the symptom's own
fix line so the "Great job! No major issues detected" fallback cannot print
beside a named symptom. The deduction's target string renders
minExcessDb — the number arrives from RULE_TABLE and is never written in
grading.js.

A future tonal rule is added by adding a RULE_TABLE row. It then fires in
Troubleshooting and grades, automatically, with no grading.js edit. Adding a
band threshold to grading.js's CONFIG, or teaching the rules engine to read
grading.js, is a violation of this ADR.

## Consequences

Positive: the grade and the Troubleshooting section can no longer
contradict each other, because the second is an input to the first. The
threshold lives once, in the MIT package, unit-testable without Electron or
a DOM. Dependency direction stays app → packages, honoring ADR-0027 and the
dual-license structure. New rules grade for free.

Negative and accepted: grades move downward for recordings that fire a rule
— mixes that previously scored A with a Muddy callout now score B. All
co-firing rules cost exactly one letter, so the number of symptoms is not
reflected in the grade's magnitude; that is a deliberate choice to align the
two engines without retuning the curve, and revisiting it needs its own
issue. The rules-engine thresholds sit outside grading.js's CONFIG, so
grading.js's broadcast profile (BROADCAST_STRICTNESS_OFFSET_DB) does not
tighten them — the tonal-symptom rule is profile-invariant until a future
issue decides otherwise. TD-013's rule that grading.js is the single
normative judgment still holds: the rules engine supplies a measurement,
grading.js alone decides what it costs.

## References

- [Issue #1246](https://github.com/on-par/sound-buddy/issues/1246)
- [ADR-0027 — Offline harshness rules are a pure data-driven audio-engine module](docs/adr/0027-offline-harshness-rules-are-a-pure-data-driven-audio-engine-module-over-the-fine-spectrum-curve-separate-from-the-live-7-band-eq-coaching.md)
- [packages/audio-engine/src/analyze/rules.ts](packages/audio-engine/src/analyze/rules.ts)
- [app/renderer/grading.js](app/renderer/grading.js)
