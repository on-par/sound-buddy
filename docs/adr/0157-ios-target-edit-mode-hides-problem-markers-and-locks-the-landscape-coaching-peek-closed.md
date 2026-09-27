# iOS target-edit mode hides problem markers and locks the landscape coaching peek closed

- Status: Accepted
- Date: 2026-09-26

## Context

Target-edit mode (#1558-#1561) puts draggable handles on the RTA's target line and an
Editing chip plus preset pills in the band under the RTA. Problem markers (#1553) are
pulsing regions drawn hugging that same target line. ADR-0156 freezes them against the
pre-edit committed curve while editing, so during a drag they would pulse under the
handles and trace the moving draft with stale geometry. In landscape (#1548) the coaching
peek is a bottom overlay up to 60% of the height that would cover the chip's Cancel/Done
and the pills, and its cards are frozen while editing anyway. #1565 requires that entering
or leaving edit mode never moves the RTA.

## Decision

While AnalyzeModel.isEditingTarget is true, Analyze draws no problem markers in either
layout (AnalyzeLayout.showsProblemMarkers(isEditingTarget:)). The model's frozen
problemMarkers are left intact, so the markers reappear unchanged on Done/Cancel and then
refresh on the next reading. In landscape, entering edit mode forces the coaching peek
closed (AnalyzeLayout.peekOpen(afterEditingChange:wasOpen:)). While editing, the peek
handle keeps its layout slot but is dimmed and not hit-testable
(AnalyzeLayout.coachingPeekEnabled(isEditingTarget:)). After exit it behaves exactly as
before. Any future overlay on the RTA or the landscape stack must likewise yield to edit
mode rather than share the canvas with the handles.

## Consequences

Edit mode always has an unobstructed RTA and control band, and no stale marker geometry
is ever shown against a draft curve. The cost is that the engineer loses the in-the-moment
problem cue and the coaching cards while editing. That is acceptable because both are
frozen against the pre-edit curve during the edit (ADR-0156). The rule lives in pure
AnalyzeLayout predicates, so it is unit-tested without a simulator. Relaxing it later, for
example to show live draft-judged markers, needs a new ADR that supersedes this one and
ADR-0156.

## References

- [Issue #1562 — Compose ideal-curve edit mode with landscape and problem-marker overlays](https://github.com/on-par/sound-buddy/issues/1562)
- [ADR-0156 — iOS coaching judges only committed target curves](0156-ios-coaching-judges-only-committed-target-curves-edit-mode-drafts-never-reach-the-coach.md)
