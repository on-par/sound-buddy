# isAbortError stays a hand-duplicated, drift-tested pure predicate instead of routing through the bundled-CJS loader

- Status: Accepted
- Date: 2026-08-10

## Context

#745 deepens the "load code that ships in Contents/Resources" seam:
engine-loader.ts, license-policy-loader.ts, and scene-inspector-loader.ts
collapse onto one loadBundledCjs helper, and the app-side readNdjsonLines
fork in ipc/shared.ts is deleted in favor of loading it lazily through
engine-loader.ts's new loadEngineUtils(), which resolves and requires the
audio-engine's dist-cjs build at call time.

app/electron/ipc/timeout.ts is a second, near-identical fork of
packages/audio-engine/src/analyze/timeout.ts. Of its exports, only
isAbortError has a real caller in the app (run-analysis.ts);
execFileWithTimeout, SubprocessTimeoutError, and the four *_TIMEOUT_MS
constants are unused beyond their own tests. run-analysis.ts's own
header comment states it is "Pure, Electron-free run orchestration...
unit-testable without a fake Electron event.sender" — every other
environment dependency it needs (engine, tools, log, logError,
removeFile) is injected via RunAnalysisOptions rather than imported
from an Electron-touching module.

loadEngineUtils()/loadBundledCjs transitively import Electron's `app`
(to resolve packaged-vs-dev) and require a real, built dist-cjs on disk
to resolve at all. Making isAbortError available through them — either
as a direct import or as a new injected RunAnalysisOptions.isAbortError
wired in from analysis.ts — would give run-analysis.ts an Electron and
dist-cjs-build dependency it does not otherwise have, and would force
every one of its ~13 existing runAnalysis(...) test call sites plus
analysis.test.ts's abort-cancellation test suite to change for no
behavioral benefit: isAbortError's actual logic (check err.name ===
'AbortError' or err.code === 'ABORT_ERR') is not something that can
drift meaningfully in a way normal tests wouldn't catch immediately.

## Decision

app/electron/ipc/timeout.ts keeps exactly one export, isAbortError,
defined locally (not loaded through loadBundledCjs). Every other export
of that file is deleted as dead code. A drift test in
app/electron/timeout.test.ts asserts app/electron/ipc/timeout.ts's
isAbortError produces identical results to
packages/audio-engine/src/analyze/timeout.ts's isAbortError over a fixed
set of AbortError-shaped, plain-Error, null, and undefined fixtures —
the same pattern shared.test.ts's #279 readNdjsonLines drift guard used
before this issue replaced it with a real loader call.

## Consequences

run-analysis.ts keeps its Electron-free, dist-cjs-build-free property
unchanged, and its existing test suite (and analysis.test.ts's
cancellation tests) needs no changes for this issue. The cost: this is
the one packaged-code seam #745 leaves as a hand-duplicated, drift-tested
copy rather than a single implementation loaded through loadBundledCjs.
Future work should default new shared pure predicates/utilities needed by
a deliberately Electron-free module to this same drift-test pattern,
rather than threading loadBundledCjs (or any other Electron-touching
loader) into that module to chase full deduplication.

## References

- [Issue #745](https://github.com/on-par/sound-buddy/issues/745)
