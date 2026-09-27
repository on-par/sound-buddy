# iOS target-curve handle drags edit the 48-point offsets with raised-cosine blending and hold the level-match shift for the duration of a drag

- Status: Accepted
- Date: 2026-09-26

## Context

#1559 lets the user reshape the ideal curve by dragging handles on the live RTA. The RTA
draws the target level-matched to the measured dB mean (ADR-0154), and that shift is
recomputed at the 20 Hz meter rate. It also moves whenever the curve's own mean moves, and
raising one handle raises that mean. If the shift stays live during a drag, the handle
slides away from the finger and the dBFS clamp bound moves mid-gesture. The curve itself is
the 48-point IdealCurve contract shared with the Mac. ADR-0154 forbids index-pairing its
dbOffsets with the ~60-band RTA grid, so edits must be made on the 48-point grid, not on
display bands. Handles on all 48 points are too dense to touch on an iPhone.

## Decision

Handle edits are made in IdealCurve offset space on the 48-point Mac grid
(IdealCurve.gridFreqs). A fixed thinned set of 10 control points (grid indices
round(k*47/9)) are the only draggable handles. Moving one handle sets its grid point
exactly. The same delta spreads to the grid points strictly between it and each
neighbouring handle, weighted by 0.5 * (1 + cos(pi * t)), and neighbouring handles never
move. TargetCurveHandles.moving in SoundBuddyKit is the only function allowed to perform
this write. While a finger holds a handle, AnalyzeModel freezes the level-match shift
captured at grab. Both the drawn line and the dBFS clamp use that frozen shift. The live
dB-mean shift resumes the moment the drag ends, is cancelled, or is committed. Drag
movement is a delta from the grab point, never an absolute jump to the finger.

## Consequences

The handle stays under the finger, and the clamp to the visible RTAScale range is exact
for the whole gesture. Edited curves remain valid 48-point ideal-curve.v1 documents that
the Mac can read, and the curve looks like a smooth spline without a spline solver. Cost:
while a drag is active, the dashed line does not follow meter-level changes, and it can
snap by a small amount on release when the live shift resumes. Only 10 frequencies are
directly editable, so finer shaping needs a future change to the handle set (which this
ADR would then need to supersede). Any future curve-editing surface (preset seeding, Mac
parity) must go through TargetCurveHandles.moving rather than writing dbOffsets ad hoc.

## References

- [Issue #1559 — draggable spline handles on the RTA](https://github.com/on-par/sound-buddy/issues/1559)
- [ADR-0154 — iOS ideal curves are resampled and dB-mean level-matched](0154-ios-ships-the-mac-built-in-ideal-curves-as-bundled-ideal-curve-v1-json-and-the-rta-target-is-resampled-onto-rta-band-centers-and-db-mean-level-matched-never-index-paired.md)
