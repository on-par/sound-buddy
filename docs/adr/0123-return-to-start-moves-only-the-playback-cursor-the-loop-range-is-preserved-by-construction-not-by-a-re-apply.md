# Return-to-start moves only the playback cursor; the loop range is preserved by construction, not by a re-apply

- Status: Accepted
- Date: 2026-08-31

## Context

Epic #1254's arrangement gained a loop region (#1313) that an engineer sets up
by dragging the brace (#1315/#1316) or by promoting a time selection (#1317).
That range lives in one shared model, sessionLoopRegion (loopBrace.render.ts),
deliberately outside every store; enablement lives separately in
soundcheckStore.looping (#1314's ADR). The Session toolbar's Return button runs
through soundcheckStore.returnToStart(), a transport action that resets the
playback cursor. Two plausible designs existed for #1318: make returnToStart
aware of the loop range and re-apply it after the reset, or keep the transport
store entirely ignorant of the arrangement's loop model so there is no write
path to clobber. The session-switch effect in LiveCapturePanel.tsx already
calls sessionLoopRegion.resetForSession(), which is exactly the shape of edit
that could migrate into a transport action by accident, so the invariant needed
to be pinned rather than left to convention.

## Decision

returnToStart resets playback position only — lastElapsedTick when stopped, an
ADR-0013 seekTo(0) restart when playing — and neither it nor the
#daw-session-return branch of LiveCapturePanel.onBoardClick may ever read or
write sessionLoopRegion or soundcheckStore.looping. Loop-range preservation
across return-to-start is structural: soundcheckStore.ts does not import
loopBrace.render, and the brace is repainted after the resulting render by
LiveCapturePanel's existing no-dep repaint effect, not by a call in the return
branch. The invariant is enforced by a behavioral composition test
(returnToStart.loopPreservation.test.ts) and by source-text drift guards in
daw-workspace-shell.test.ts. Only session load/switch (resetForSession) and the
explicit loop gestures may write the range.

## Consequences

Positive: a loop set up with the brace can never be lost by pressing Return; the
transport store stays free of arrangement concepts, so it needs no knowledge of
the ruler; the guarantee is verified by tests rather than asserted in a comment.
Negative: the guarantee is an absence, so it can only be defended by drift
guards, which are coupled to the shape of onBoardClick's return branch and will
need updating if that handler is restructured. A future feature that genuinely
wants "return to loop start" instead of "return to zero" must reopen this ADR
rather than quietly add the read.

## References

- [Issue #1318 — Preserve the loop range when returning to start](https://github.com/on-par/sound-buddy/issues/1318)
- [ADR — the Loop toggle owns enablement; the loop region model stays enablement-free (#1314)](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0120-loop-enablement-lives-in-soundcheckstore-looping-the-loop-region-model-stays-enablement-free.md)
