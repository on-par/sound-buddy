# The Session BPM control is a free-text field validated by the pure tempo clamp, committed on change

- Status: Accepted
- Date: 2026-08-30

## Context

#1276 adds the first user-writable control inside the Session DAW shell's
raw markup. Two forces shape it. First, the shell is rendered as one HTML
string through dangerouslySetInnerHTML in LiveCapturePanel: any state write
rebuilds that string and destroys the live DOM node, so a control that
writes state per keystroke would tear out the element the user is typing
into. Second, the tempo already has exactly one validation rule —
clampTimelineBpm in timeline-bpm.ts (#1278), which clamps out-of-range
values to TIMELINE_MIN_BPM/TIMELINE_MAX_BPM and rejects non-finite input.
An <input type="number"> would put a second, invisible rule in front of it:
Chromium's number-input sanitizer blanks non-numeric text before any
listener sees it, so "non-numeric entry shows validation feedback" could
not be implemented or e2e-tested through that element at all (Playwright's
fill() likewise refuses non-numeric text on a number input).

## Decision

The BPM control is an <input type="text" inputmode="decimal"> whose value is
never validated by the browser. Every entry is committed by the board's
existing native 'change' delegate — which fires on blur or Enter, not per
keystroke — through commitTimelineBpmEntry(raw, tempo) in the pure
timeline-bpm-control.ts, which parses the raw string, routes every accepted
or clamped result through #1278's withTimelineBpm, and returns the tempo to
store plus the actionable feedback message to display. A non-numeric or
empty entry returns the unchanged tempo, so an invalid BPM can never be
stored. Any future editable control added to this shell follows the same
shape: raw markup, commit on 'change', validation in a pure module, never an
HTML-level validity constraint and never a per-keystroke state write.

## Consequences

Positive: one validation rule, in one unit-tested pure function, covering
out-of-range and non-numeric entry identically; the feedback string is
derived from TIMELINE_MIN_BPM/TIMELINE_MAX_BPM so bounds and copy cannot
drift; the innerHTML rebuild never interrupts typing; the whole path is
testable without a DOM, with e2e only confirming the delegate is wired.
Negative: the control loses no browser affordances that matter here but
does give up native spinner arrows and step keys, which would have to be
re-implemented if wanted; feedback appears only on commit, not as the user
types; and the field's value resets to the stored BPM whenever an unrelated
store change rebuilds the shell mid-edit — acceptable because the shell is
quiescent while idle (meter ticks bypass React per ADR-0005).

## References

- [Issue #1276 — Add a compact BPM control to the Session toolbar/ruler area](https://github.com/on-par/sound-buddy/issues/1276)
- [ADR-0104 — Timeline BPM is a separate, display-only tempo model](docs/adr/0104-timeline-bpm-is-a-separate-display-only-tempo-model-the-timeline-scale-and-every-coordinate-stay-in-real-seconds.md)
