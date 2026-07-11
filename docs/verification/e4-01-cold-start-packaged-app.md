# Verification e4-01 — Cold-start-to-first-report-card on a packaged build

**Issue:** [#141](https://github.com/on-par/sound-buddy/issues/141) · **Type:** test ·
**Epic:** onboarding

**Status:** TEMPLATE — fill in on each packaged-build run

## What this verifies

The first-run promise: a fresh Mac, an unsigned app opened via Gatekeeper right-click ▸ Open, the
welcome overlay appears, one click runs the bundled `demo.wav`, and a report card renders — in
under 5 minutes, end to end.

## Automated coverage note

`app/tests/packaged-onboarding.spec.ts` (run via `./scripts/verify.sh`, requires a built
`app/release/*-arm64-mac.zip`) already asserts the overlay → demo → report-card steps against the
real packaged `.app`, with a scrubbed `PATH` proving the bundled sox/ffprobe/python run with no
external tools. It does **not** and cannot cover the Gatekeeper right-click ▸ Open prompt (macOS
UI, not automatable via Playwright) or the human-timed 5-minute budget for the *complete* flow
starting from installation. This checklist exists to cover exactly those two gaps. Run the
automated spec first; use this checklist for the remainder.

## Preconditions

- A freshly packaged `.app`, either built locally via `cd app && npm run dist` or pulled from a
  GitHub release (the app is unsigned, ad-hoc-distributed — see the packaging notes).
- A clean macOS user profile, or at minimum no prior `sb-onboarding-seen-v1` state for this app.
  The quickest way to get a clean profile without a throwaway macOS user account: delete the app's
  `~/Library/Application Support/Sound Buddy` data before launch.

## Scripted checklist

| Step | Expected | Pass/Fail | Notes |
|---|---|---|---|
| 1. Install from the packaged artifact (unsigned) — copy `.app` to `/Applications`. | Copy succeeds; no install prompt. | | |
| 2. Gatekeeper: first double-click. | Blocked by Gatekeeper ("cannot be opened because it is from an unidentified developer" or similar). | | |
| 2a. Right-click ▸ Open. | "Open" confirmation dialog appears. | | |
| 2b. Confirm "Open". | App launches without a crash. | | |
| 3. First launch on the clean profile. | The onboarding welcome overlay appears **exactly once**. | | |
| 4. Click "Run your first analysis". | Report card renders from the bundled `demo.wav`, with zero external hardware involved. | | |
| 5. Relaunch the app. | The overlay does **not** reappear (gate persisted). | | |

## Timing record

- **Start time (double-click on the installed `.app`):** ______
- **First-report-card time (report card visible after step 4):** ______
- **Elapsed:** ______ (must be **< 5:00**)
- **Overall PASS/FAIL:** ______

## Follow-ups

Any bug found while running this checklist is filed as a **new issue**, not fixed as part of this
verification pass — this checklist and its companion spec only verify; they do not remediate.
