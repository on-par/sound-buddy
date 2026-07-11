# Decision: Ideal Profile Match card — integrate vs de-emphasize

- **Issue:** [#138](https://github.com/on-par/sound-buddy/issues/138) (spike)
- **Epic:** grade-trust
- **Date:** 2026-07-08
- **Status:** Decided
- **Decision:** **De-emphasize** the card (do not integrate into the letter grade;
  do not hide it wholesale) **and guard the renderer↔engine mirror with a drift test.**
- **Follow-up chore:** [#160](https://github.com/on-par/sound-buddy/issues/160) —
  _de-emphasize Ideal Profile Match card + add renderer↔engine drift test_

This is a decision-only spike. It changes **no** grading behavior; implementation is
tracked in the follow-up chore.

---

## Context

The report card shows an **"Ideal Profile Match"** score (0–100). The comparison logic
lives in two places:

- **Authoritative, unit-tested:** `packages/audio-engine/src/profiles/index.ts`
  (`PROFILES`, `compareToProfile`), covered by
  `packages/audio-engine/src/profiles/profiles.test.ts`.
- **Renderer copy:** `IP_PROFILES` + `ipCompare` at `app/renderer/index.html:1505`,
  a **hand-maintained mirror** (the renderer is a bundler-free static page, so — like
  the mirrored types in `app/electron/ipc/analysis.ts` — it keeps its own inline copy).

Two problems motivated the spike:

1. **Two grade-like scores.** `renderProfileMatch` (`app/renderer/index.html:3886`)
   renders the match as a large **"NN/100"** tinted with the **same grade-A/B/C/D
   colors** as the real grade, and it sits in the report card right next to the
   **"Overall Grade"** ring (also a color-coded "NN/100" with a letter). A church-audio
   volunteer cannot easily tell which number *is* the grade.
2. **Silent drift risk.** The renderer's `IP_PROFILES` can diverge from the engine's
   `PROFILES` with nothing to catch it. They are byte-identical **today** (verified
   during this spike — same shape helpers, same `worship-service` array), but the
   mirror is unguarded.

### Confirmed: the match score does NOT feed the grade

`computeGrade` (`app/renderer/index.html:3780`) and `computeScore` (`:3799`) are driven
solely by clipping, RMS, dynamic range, and inter-band balance. **`matchScore` is never
read by either.** So the profile match is a fully decoupled, second grade-like display —
the exact confusion the issue flags.

---

## Options considered

### A. Integrate the match score into the letter grade

Fold `matchScore` into `computeGrade` / `computeScore`.

- **Confusion cost:** Resolved (one grade) — but only if the match number is then
  removed as a standalone display; otherwise it persists.
- **Drift risk:** *Worsened.* The grade would now depend on a hand-mirrored profile
  table, so drift would silently move real grades.
- **Effort:** **L.** Re-weighting a trust-critical grade, re-tuning the A–F cutoffs,
  and updating the "why this grade" breakdown (`e2-05`). Grade changes need their own
  validation pass.
- **Verdict:** **Rejected for MVP.** Explicitly out of scope for #138 ("no change to the
  letter grade"), and it couples the grade to a content-type-dependent target (the
  `worship-service` profile is aggressive) — high risk against the grade-trust epic.

### B. De-emphasize — keep the card, strip its grade-mimicry (chosen)

Keep the feature and its deviation curve, but make it read as a **tonal-balance
diagnostic**, not a grade: drop the grade-A/B/C/D coloring on the number, demote the
"NN/100" so it stops competing with the ring, and let the per-frequency deviation curve
be the hero. Guard the mirror with a **drift test**.

- **Confusion cost:** Resolved — only one thing looks like a grade (the ring). The match
  becomes a supporting "how close is your tone to the target" readout.
- **Drift risk:** Resolved cheaply by a test (see anti-drift below) — no runtime change,
  no build-step churn.
- **Effort:** **S.** CSS/markup tweak in `renderProfileMatch` + one unit test. No grade
  behavior change.
- **Verdict:** **Chosen.** Best confusion/drift/effort trade for MVP; preserves a shipped
  feature (PRD 05) that recent work actively feeds — the custom ideal-curve editor
  ([#156](https://github.com/on-par/sound-buddy/issues/156)) and the worship-service
  target ([#158](https://github.com/on-par/sound-buddy/issues/158)).

### C. Hide the card entirely for MVP

Remove/flag-off the profile match card.

- **Confusion cost:** Resolved (nothing extra to confuse).
- **Drift risk:** Moot while hidden — but re-enabling later reintroduces an unguarded
  mirror, so a drift test is still eventually needed.
- **Effort:** **XS.**
- **Verdict:** **Rejected.** Throws away a built, MVP-in feature that #156/#158 just
  invested in. De-emphasis (B) removes the confusion without discarding the value.

---

## Anti-drift approach (for the kept card)

Use a **drift test**, not a shared-module refactor.

Per the AC's second option ("a test asserting `index.html` profiles match
`packages/audio-engine/src/profiles/index.ts`"): add an app-side Vitest test that parses
/ evaluates the `IP_PROFILES` block out of `app/renderer/index.html` and asserts deep
equality against the engine's exported `PROFILES` — matching `id`, `label`,
`description`, `freqs`, and `dbOffsets`.

Why a test and **not** a shared module: the renderer is intentionally bundler-free
(a static page loaded directly by Electron), which is exactly why the profile table is
hand-mirrored today — the same rationale documented for the `electron/ipc/analysis.ts` type
mirror. A shared import would force a bundling/copy step the renderer deliberately
avoids. A drift test gets the safety (CI fails the instant the copies diverge) at a
fraction of the cost and risk.

---

## Recommendation

Adopt **Option B**. Track implementation in the follow-up chore
[#160](https://github.com/on-par/sound-buddy/issues/160):

1. De-emphasize `renderProfileMatch` so it no longer mimics the grade ring (no
   letter-grade colors, demote the "/100"; reframe as a tonal-balance diagnostic).
2. Add the renderer↔engine drift test described above.

The letter grade stays untouched.
