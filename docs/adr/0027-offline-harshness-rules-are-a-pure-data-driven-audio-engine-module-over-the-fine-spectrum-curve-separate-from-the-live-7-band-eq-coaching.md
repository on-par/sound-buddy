# Offline harshness rules are a pure data-driven audio-engine module over the fine spectrum curve, separate from the live 7-band EQ coaching

- Status: Accepted
- Date: 2026-08-16

## Context

#381 needs symptom-to-frequency advice on the offline report card. The shared spectral-analysis core (#376) exposes bandEnergy over the fine log-grid SpectrumCurve (48 pts, 20 Hz–20 kHz) and is landed but unused for this. Meanwhile the app already ships a separate live-capture EQ coaching path (app/renderer/live-adjustments-state.js) whose harshness/low-end candidates are derived from the coarse 7-band per-window averages with thresholds sourced from grading.js CONFIG, gated behind a live experiment, and living in proprietary app/renderer. A future engineer could "simplify" by reusing that live path for the offline rules — coupling offline advice to a live experiment, to renderer grading constants, and to a coarser band resolution than the shared core provides. The issue also defers all prose rendering of rule hits to #375.

## Decision

Ship #381 as a pure module packages/audio-engine/src/analyze/rules.ts: a data-driven RULE_TABLE (per-instrument BandCondition rules with symptom → target-band suggestions) plus evaluateRules(curve, instrumentId?) that fires rules through the shared bandEnergy primitive (#376) and returns structured FiredRule[] results. The module never imports app renderer code and never reuses live-adjustments-state.js's thresholds (those stay live-scoped and grading-coupled); no report-card rendering is added here — the structured output is the seam #375 renders.

## Consequences

Positive: offline advice is single-sourced in the MIT audio-engine package, unit-testable without Electron/DOM, data-driven (adding a rule is adding a table row), and #375 can render FiredRule directly. Negative: two harshness concepts now coexist (the live coaching candidate vs the offline rule) with overlapping frequency language (2–6 kHz vs 2–4 kHz) and can drift; unifying them is explicitly out of scope for this issue and the live path stays untouched.

## References

- [packages/audio-engine/src/analyze/spectral.ts (#376 shared core)](packages/audio-engine/src/analyze/spectral.ts)
- [app/renderer/live-adjustments-state.js (live 7-band coaching, not reused)](app/renderer/live-adjustments-state.js)
- [Issue #381](https://github.com/on-par/sound-buddy/issues/381)
