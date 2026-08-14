# Soundcheck scrub commits seeks on pointer release, not per pointer-move

- Status: Accepted
- Date: 2026-08-13

## Context

Epic #732's story 4/4 must give the Virtual Soundcheck timeline a real playhead and
click/drag scrubbing. ADR-0013 shipped seeking as restart-with-start-offset: every seek
SIGTERMs the in-flight playback.py child and re-spawns it with `--start-at`, a full device
close + reopen measured at ~0.2–0.4s. The SpectrogramScrubber precedent seeks on every
pointermove because its `<audio>.currentTime` write is free; mirroring that here would fire
a child restart per mousemove event — a cascade of 0.2–0.4s restarts that reads worse than
stepped. The scrub UX (visual follow live, backend commit once) is a deliberate policy a
future implementer must not "fix" into per-move seeks without first shipping ADR-0013's
deferred in-process seek.

## Decision

The playhead follows the pointer live during a drag via imperative `style.left` writes (no
React re-render, no backend call), and the single `startPlayback`-with-`startOffsetSecs` call
commits on pointerup. A click (down+up without movement) is the degenerate case of that one
release-commit. Interaction is gated on the soundcheckStore `playing` flag.

## Consequences

Positive: responsive visual scrubbing with exactly one playback restart per gesture, on the
existing ADR-0010 child lifecycle — no new IPC, Python, or Electron-main surface. Negative:
audio changes on release rather than mid-drag, which is documented in the story. If
in-process seeking (ADR-0013 approach b) ships later, this policy relaxes to per-move
commits with no layout or IPC change.

## References

- [ADR-0013 — Playback seeking ships as restart-with-start-offset; in-process seek stays deferred](docs/adr/0013-playback-seeking-ships-as-restart-with-start-offset-in-process-seek-stays-deferred.md)
- [ADR-0005 — Discrete spectrum state in the store](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/736)
