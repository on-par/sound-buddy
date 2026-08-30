# BPM/real-seconds isolation is enforced by a coordinate-owner import ban, not a keyword scan

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0104 established that the Session timeline's BPM is display-only: it labels the
bars/beats ruler and never participates in a coordinate, a transport position, a scrub
seek target, a clip duration or a waveform bucket. That intent was enforced only by
review plus one pure unit assertion (timeline-ruler-labels.test.ts: xPx is identical
across tempos). #1277 asked for a durable guard that no quantization/snap/warp code path
can appear. Two mechanisms were on the table. A keyword scan for /quantiz|snap|warp/i
over the timeline modules false-positives immediately — soundcheck-waveform.ts
legitimately documents ADR-0004's u8 amplitude quantization, which has nothing to do
with musical time. The alternative is to name the modules that own real-seconds
geometry and forbid them from importing the tempo model at all, which is precise: the
only way tempo can reach a coordinate in this codebase is for a coordinate owner to
import ./timeline-bpm (directly or via a tempo-carrying module).

## Decision

A structural gate in app/renderer/src/daw-workspace-shell.test.ts asserts that none of
the coordinate-owning renderer modules — timeline-scale.ts, daw-shell-runtime.ts,
session-tab-waveforms.ts, soundcheck-waveform.ts, soundcheck-playhead.ts,
session-timeline-scrub.ts and session-tab-playback.ts — imports ./timeline-bpm.
timeline-ruler-labels.ts stays the single sanctioned module that holds both a
TimelineScale and a TimelineTempo, and it holds them one-directionally (scale ->
geometry, tempo -> text). Any future quantization, snapping or warping feature must
land in a new module with its own ADR amending this list — it may not be added by
quietly importing the tempo model into an existing coordinate owner. The integration
counterpart lives in app/renderer/src/session-tab-playback.e2e.spec.ts, which proves
through the real shell that a BPM commit re-labels the ruler while leaving the
transport readout, both playhead segments, the scrub seek offset, the take clip's
width and the clip canvas bitmap unchanged.

## Consequences

Positive: the display-only contract is now machine-checked at both levels — a pure
structural gate that cannot false-positive on unrelated uses of the word
"quantization", and an e2e that survives the board's full dangerouslySetInnerHTML
rebuild on every BPM commit. A future snap-to-grid feature is forced to declare itself
in an ADR instead of arriving as a one-line import. Negative: the module list is
hand-maintained, so a newly created coordinate owner is not covered until it is added
to the list; and the ban is import-level, so it would not catch tempo smuggled through
an intermediate module that is itself allowed to import ./timeline-bpm. Both are
accepted: the list sits in a file reviewers already read for structural rules, and the
e2e catches behavioral coupling regardless of how it is plumbed.

## References

- [ADR-0104 — Timeline BPM is a separate display-only tempo model](docs/adr/0104-timeline-bpm-is-a-separate-display-only-tempo-model-the-timeline-scale-and-every-coordinate-stay-in-real-seconds.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/1277)
