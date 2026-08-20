# Capture diff is a content-level pure function in scene-inspector; file paths stay in the app layer

- Status: Accepted
- Date: 2026-08-19

## Context

#891 wires a before/after console-capture diff. Two plausible homes
existed. app/electron/scene-diff.ts's computeSceneDiff (#264) already
takes two .scn *paths*, validates the extension, checks existence, reads
the files, parses and diffs them, translating every failure into a
user-facing message - but it is Electron main-process code in the
proprietary app/ tree, and it cannot serve a capture that
captureSceneFromConsole (#888) has produced in memory but not yet
written. packages/scene-inspector is MIT, fs-free, Electron-free and
already owns Scene semantics (parseScene, diffScenes), which makes it the
natural home for capture-level assembly - but only if it stays free of
filesystem concerns, or the two layers would grow duplicate path
validation and duplicate error copy that must be kept in sync.

## Decision

packages/scene-inspector exposes diffCaptures(before, after) operating on
capture *contents* - a CaptureRef of { source, content } where source is
an opaque caller-supplied label used only in messages and in the returned
identity. It performs no I/O, imports no node builtins, and returns the
SceneDiff from diffScenes() verbatim alongside a CaptureIdentity for each
side. Reading files, validating extensions and existence, and mapping
those failures to user-facing copy remain the caller's job:
app/electron/scene-diff.ts's computeSceneDiff for the drop-two-files
flow, and future capture UI (C3b) for console captures. No fs-aware or
path-aware diff helper is to be added to scene-inspector.

## Consequences

Positive - captures can be diffed straight out of the console walk with
no temp file; the MIT package stays portable and unit-testable with no
Electron or fs doubles; there is exactly one place that owns path
validation copy. Negative - callers that only have paths must read the
files themselves, so the two entry points (computeSceneDiff and
diffCaptures) coexist and a future consolidation would mean rewriting
computeSceneDiff on top of diffCaptures rather than deleting either.
Error copy therefore lives in two places and must stay consistent in
tone; both are covered by tests that assert on the message.

## References

- [app/electron/scene-diff.ts - the existing path-based wiring (#264)](https://github.com/patrob/sound-buddy/issues/264)
- [#888 - .scn scene capture via /node tree walk](https://github.com/patrob/sound-buddy/issues/888)
- [#887 - diffScenes phantom changes on -oo faders](https://github.com/patrob/sound-buddy/issues/887)
- [Issue #891](https://github.com/on-par/sound-buddy/issues/891)
