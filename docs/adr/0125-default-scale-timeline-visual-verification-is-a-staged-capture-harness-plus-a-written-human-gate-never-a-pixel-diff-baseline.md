# Default-scale timeline visual verification is a staged-capture harness plus a written human gate, never a pixel-diff baseline

- Status: Accepted
- Date: 2026-08-31

## Context

ADR-0124 settled how the Session arrangement's time-to-x alignment is PROVED: one DOM-geometry e2e
spec with a named pixel tolerance, and no screenshot, visual diff, or toHaveScreenshot assertion may
enter it. #1295 asks for the complementary thing ADR-0124 deliberately does not cover — a human
looking at the default-scale arrangement in a running app and confirming there is no visible
rendering artifact. Numeric x-agreement is blind to a whole class of defects: a gridline painted
under the clip, waveform columns clipped by an overflow rule, a hairline the compositor drops, a
playhead behind the lane background. The obvious ways to automate that judgment are exactly the ones
ADR-0124 rejects (screenshot baselines are non-deterministic across CI boxes and report "the picture
changed"), and the obvious way to keep it manual — a checklist nobody can re-run because staging the
scene takes ten minutes of clicking — decays into a gate that is never exercised again.

## Decision

Visual verification of the Session arrangement ships as two artifacts that are kept in step. First,
app/tests/e2e/timeline-default-scale-visual.spec.ts stages the inspected scene deterministically and
asserts PAINTEDNESS only — every inspected surface is attached, visible, has non-zero painted extent,
and the waveform canvas carries ink — then captures a PNG of .daw-shell into the Playwright output
dir and attaches it to the report. It never asserts alignment, never compares images, and never gains
a toHaveScreenshot baseline; alignment remains the exclusive property of timeline-alignment.spec.ts
per ADR-0124. Second, docs/session-timeline-default-scale-visual-verification.md is the human gate: it
names the commands (headless capture, SB_E2E_HEADED=1 for a visible window, dev mode for a real
session with live-recorded takes), the five-surface inspection checklist, the pass criteria, and a
Result record that a human signs. A future visual-regression request is answered by re-running this
gate and appending a Result record entry, not by adding a screenshot baseline to CI.

## Consequences

Positive: the class of defect that x-position assertions cannot see gets a cheap, repeatable, always
green-or-red machine check (is it painted at all?) plus a two-minute human step instead of a
ten-minute staging chore, so the gate is likely to actually be re-run after a geometry change. CI
stays deterministic — no image baselines to rebaseline on a different box. The capture spec is
IPC-stubbed and therefore runs in the SB_E2E_STUBBED_ONLY lane like its siblings. Negative: the
human half of the acceptance criterion is genuinely human — a PR can be green with an unsigned
Result record, so reviewers must treat the record as part of the diff. The capture depends on
Playwright being able to screenshot Electron's show:false window; where it cannot, the artifact must
be produced by a headed local run and the runbook says so. And the staged scene is the stubbed
fixture session, so a defect that only appears with real recorded audio is caught by the runbook's
dev-mode variant, not by CI.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1295)
- [ADR-0124 — Timeline alignment is proved by one DOM-geometry e2e spec, never by screenshots](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0124-timeline-alignment-is-proved-by-one-dom-geometry-e2e-spec-never-by-screenshots.md)
