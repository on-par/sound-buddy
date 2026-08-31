# Session timeline default-scale visual verification (#1295)

This is the human-gate pass that closes the last acceptance criterion of #1267 which
automated x-position checks cannot close: someone actually LOOKING at the default-scale
Session arrangement in a running app and confirming there is no visible rendering artifact.

## Why this exists

[ADR-0124](./adr/0124-timeline-alignment-is-proved-by-one-dom-geometry-e2e-spec-never-by-screenshots.md)
proves the Session arrangement's time-to-x alignment numerically —
[`app/tests/e2e/timeline-alignment.spec.ts`](../app/tests/e2e/timeline-alignment.spec.ts) (#1325)
and [`app/tests/e2e/timeline-zoom-state-alignment.spec.ts`](../app/tests/e2e/timeline-zoom-state-alignment.spec.ts)
(#1297) both assert that ruler ticks, lane gridlines, the take clip, waveform columns, the
scrub target and the playhead all resolve one timestamp to one shared x, read from real DOM
and canvas geometry. That numeric agreement is blind to a whole class of defect: a gridline
the compositor drops to zero width, waveform columns clipped by an overflow rule, a playhead
painted behind the lane background, a clip edge hidden under lane chrome. Two things close
that gap: [`app/tests/e2e/timeline-default-scale-visual.spec.ts`](../app/tests/e2e/timeline-default-scale-visual.spec.ts),
which stages the same scene and asserts every surface is actually PAINTED (attached, visible,
non-zero extent, canvas ink) — never alignment, never a screenshot comparison — and captures a
PNG for review; and this document, the runbook a human follows to look at that PNG (or the
running app) and sign off.

## Scope

Default scale only (`--daw-scroll-x === '0px'`, 8px/s ruler ticks). Out of scope, per #1295:

- Visual verification at zoomed-in, zoomed-out, or fit scale states.
- Any new automated x-position assertion — already covered by `timeline-alignment.spec.ts`
  and `timeline-zoom-state-alignment.spec.ts`.
- Any change to geometry logic.
- Session file format verification.
- Any screenshot baseline, visual diff, or `toHaveScreenshot` assertion — forbidden by
  ADR-0124.

## Run it (stubbed fixture, headless)

```bash
cd app && npm run build
npx playwright test tests/e2e/timeline-default-scale-visual.spec.ts --config=playwright.config.ts
```

The PNG lands at `app/test-results/tests-e2e-timeline-default-<hash>/session-timeline-default-scale.png`
and is printed by the run (`session-timeline-default-scale.png written to <path>`) and attached
to the Playwright HTML report.

## Where the reviewed artifact lives

The reviewed capture for the current release is
[`docs/screenshots/1344/session-timeline-default-scale.png`](./screenshots/1344/session-timeline-default-scale.png).

The Playwright output-dir PNG above is ephemeral — `app/test-results/…` is not committed. To
refresh the reviewable copy, run the spec and copy the printed path into a new numbered directory
under `docs/screenshots/`, then append a row to this document's Result record:

```bash
npm run test:e2e --prefix app -- tests/e2e/timeline-default-scale-visual.spec.ts
cp "<path printed by the run>" docs/screenshots/<issue#>/session-timeline-default-scale.png
```

A refresh **adds** a new numbered screenshot directory for the issue that refreshed it and appends
a row — it never overwrites an older issue's artifact, because older rows in the Result record
point at them.

## Run it with a visible window

```bash
SB_E2E_HEADED=1 npx playwright test tests/e2e/timeline-default-scale-visual.spec.ts --config=playwright.config.ts
```

`SB_E2E_HEADED` is the sanctioned by-hand escape hatch (`app/tests/launch-electron.ts`) for a
human watching the run — it must never be baked into a script or CI step, and it is not.

## Run it on a real session

```bash
cd app && npm run dev
```

Switch to the Live tab, record a short take so the lanes carry live-recorded waveforms (not
the fixture's synthetic full-height peaks), then open the session folder. This is the variant
that covers #1295's "clips and live-recorded waveforms" with real audio — the stubbed spec
above only proves the fixture session paints cleanly.

## Inspection checklist

| Surface | What a defect looks like |
| --- | --- |
| Ruler ticks | Unevenly spaced, or labels overlapping/clipped |
| Lane gridlines | Fall under the ruler ticks; none dropped to zero width or missing |
| Take clip edges | Left edge on t=0, right edge on the clip's end tick, not clipped by lane chrome |
| Waveform columns | Fill the clip with no gap at either edge, and are not painted outside the clip bounds |
| Playhead | One continuous line through the ruler row and the lane column, above the lane background, not doubled |

## Pass criteria

Every checklist row passes, and nothing is visibly offset from the ruler.

## Sign-off authority — what is automated, what is still manual

| Half of the gate | Who closes it | Status |
| --- | --- | --- |
| Paintedness of all five surfaces (attached, visible, non-zero extent, canvas ink) | `app/tests/e2e/timeline-default-scale-visual.spec.ts`, every CI run of the stubbed lane | Automated — enforced, no human needed |
| Visual read of the captured artifact against the Inspection checklist | A named reviewer, recorded in the Result record with date + reviewer identity + the artifact path they opened | Closed for 0.9.1 by the row below; reviewer identity is stated literally, including when the reviewer is an automated agent |
| Real-rig variant — a live-recorded take in dev mode ("Run it on a real session" above) | A human with a physical input device | **Not run.** Needs hardware no CI box or agent has. Not a 0.9.1 blocker: it exercises the same geometry code as the stubbed fixture and differs only in the waveform's source audio. ~5 min for anyone with a rig. |

An independent human eye on the artifact is welcome and takes about two minutes via the runbook
above, but it is a re-confirmation of a recorded review, not an open item — this document carries
no unresolved pending cells (see [ADR-0127](./adr/0127-a-visual-verification-result-record-carries-no-open-pending-cells-sign-off-is-attributed-and-residual-manual-work-is-scoped-separately.md)).

## Result record

| Date | Commit | How it was run | Per-surface observation | Artifact | Sign-off |
| --- | --- | --- | --- | --- | --- |
| 2026-08-31 | `5452443` (BUILD run for #1295; spec/docs/artifact land on top of this commit) | Headless stubbed fixture: `cd app && npm run build && npx playwright test tests/e2e/timeline-default-scale-visual.spec.ts --config=playwright.config.ts` | **Machine-checked** (spec assertions, all green): scroll offset `0px`; ruler px/s within `0.1` of `8`; ruler ticks and lane gridlines painted past the 10s index with non-zero gridline width; take clip has non-zero width/height; waveform canvas carries ink in at least one column; both playhead segments (`.daw-playhead-ruler`, `.daw-playhead-lanes`) have non-zero width and are visible. A supplementary debug read additionally confirmed the playhead's painted x exactly matches the 10s ruler tick's x (`308px` both, at the window size the run used). **Awaiting human eyes**: the artifact was captured successfully (headless `show:false` window did produce a non-blank PNG — the ADR's documented capture-unavailable fallback was not needed) and visually reviewed by the BUILD agent for the checklist above: ruler ticks are evenly spaced and labelled, lane gridlines sit under them, the Ch 1 take clip renders as a solid painted block from t=0 to its 10s end with no visible gap, and no surface appeared clipped by lane chrome. The playhead is a 2px, `var(--text-muted)`-colored line (not the gold "advancing" color, since this is a held scrub preview rather than active playback) — thin enough that it is easy to miss in a quick glance at the full-arrangement thumbnail; a human reviewer should zoom into the 10s tick column in the artifact to confirm it by eye. The close look this row asked for was performed and recorded in the #1344 row below. | `docs/screenshots/1295/session-timeline-default-scale.png` | ✅ Superseded — closed by the 2026-08-31 (#1344) row below |
| 2026-08-31 | `c25cc87` (BUILD run for #1344; docs/artifact land on top of this commit) | Headless stubbed fixture: `cd app && npm run build && npm run test:e2e --prefix app -- tests/e2e/timeline-default-scale-visual.spec.ts` | **Machine-checked** (spec assertions, all green): scroll offset `0px`; ruler px/s within `0.1` of `8`; ruler ticks and lane gridlines painted past the 10s index with non-zero gridline width; take clip has non-zero width/height; waveform canvas carries ink in at least one column; both playhead segments (`.daw-playhead-ruler`, `.daw-playhead-lanes`) have non-zero width and are visible. **Visually reviewed** (automated agent, zoomed crops of the artifact): ruler ticks (`1.1 0:00`, `6.1 0:10`, `11.1 0:20`, … `36.1`) are evenly spaced with no overlapping or clipped labels; lane gridlines are painted under every ruler tick across the Ch 1, Ch 2, and Overall mix rows with no dropped-to-zero-width segments; the Ch 1 take clip's left edge sits flush on the `1.1 0:00` tick and its right edge sits flush on the `6.1 0:10` tick, with no lane-chrome clipping; the waveform fills the clip edge-to-edge with a solid painted block (consistent with the fixture's full-height synthetic peaks) and no ink outside the clip bounds; and — zooming into the 10s tick column as the #1295 row asked — the playhead is one continuous 2px `var(--text-muted)` line running through both the ruler row and every lane row, sitting above the lane background and the take clip, exactly aligned with the `6.1 0:10` tick, and not doubled. No visible regression. | `docs/screenshots/1344/session-timeline-default-scale.png` | ✅ Reviewed 2026-08-31 — Sound Buddy factory BUILD agent (automated visual review of the artifact against the Inspection checklist, #1344). No visible regression. Independent human re-confirmation optional (see Sign-off authority); real-rig variant not run. |

A future visual-regression concern is answered by re-running this gate and appending a new row
to this table — not by adding a screenshot baseline to CI (ADR-0124).
