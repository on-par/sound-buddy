# Scene capture emits a generated, fixture-pinned node-path table and refuses to write a partial .scn

- Status: Accepted
- Date: 2026-08-19

## Context

Issue #888 asks Sound Buddy to save the M32R's live state as a `.scn`, the way
M32-Edit does. The #848 discovery session proved the mechanism: a `.scn` is a
synthesized one-line header plus plain-text OSC node lines, `/node` returns those
lines verbatim, and a read-only walk of 2103 known paths captured 2103/2103 lines
with 0 misses in 22.9s at ~250 queries/s, producing a node-path set identical to a
real X32-Edit export. ADR-0061 already pins where the pieces live: packages/console
owns the OSC wire format, the Electron main process owns the socket, and every Tier 2
path passes the ADR-0006/0013 consent gate first.

That leaves two decisions the code alone would not explain. First, where the 2103
paths come from. A literal 2103-line array is unreviewable and hides the console's
structure; discovering paths at runtime by recursing `/node` containers is unproven
against this firmware and would make both capture duration and completeness
data-dependent, so the "0 misses" acceptance criterion could not be asserted at all;
reading the committed capture fixture at runtime is impossible in a shipped build,
because packages/console builds with tsc and copies no data files into dist/ or into
the packaged .app. Second, what to do with an incomplete walk. A `.scn` missing lines
is not obviously broken — it opens, it parses, it looks like a scene, and it silently
misrepresents the board. That failure mode is worse than no file at all, and it would
be discovered on a Sunday.

## Decision

SCENE_NODE_PATHS is built at module load in packages/console/src/scene-capture.ts from
a compact family table (channel/aux/fxrtn/bus/matrix/main subpath sets, index ranges,
and zero-padding widths), emitted in X32-Edit's own order, and pinned by an order-exact
drift test asserting it equals the node paths of the committed real-console capture
packages/console/src/capture-2026-08-16.scn line for line. That fixture is the oracle
for the table, never a runtime input. Any future console model, firmware revision, or
newly discovered path family is added to the family table together with a capture
fixture that proves it — not by hand-editing a list of strings.

assembleSceneFile is the only way a capture becomes text, and it throws
SceneCaptureError naming the missing count and the first missing path whenever any
member of SCENE_NODE_PATHS is absent from the collected lines. There is no incremental
write path and no "best effort" mode: a partial capture never becomes a string, so it
can never become a file. captureSceneToFile calls its injected writeFile only after
assembly has succeeded.

## Consequences

Positive: the path list is ~60 reviewable lines that state the console's structure
explicitly, and it cannot drift from real-console evidence without a test failing.
Capture completeness is a hard invariant enforced at one chokepoint rather than a
property callers have to remember to check, so the silently-wrong-scene failure mode
is structurally unavailable. The fixture doubles as the byte-exact round-trip oracle:
feeding its own lines back through buildSceneHeader + assembleSceneFile reproduces the
file exactly, which proves order, count, header format and trailing newline in one
assertion.

Negative: the family table is a second representation of something the fixture already
contains, so both must be updated together when the path set changes — the drift test
makes that failure loud, not impossible. An all-or-nothing capture means a single
unanswered path on a flaky church network costs the whole ~23s walk and forces a
retry; a future partial-recovery mode (re-query only the gaps) would be a real
improvement but must still never write an incomplete file. And because the fixture is
one console at one firmware level, a different M32/X32 variant may need paths this
table does not yet carry; it will fail loudly as a rejected capture rather than
silently emit a short file.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/888)
- [ADR-0061 — packages/console owns the wire format, Electron main owns the socket](docs/adr/0061-osc-feasibility-spike-371-concludes-feasible-with-environmental-risk-packages-console-owns-the-wire-format-electron-main-owns-the-socket.md)
- [ADR-0006 — Tier 2 console-network consent is granted only by the first-run modal](docs/adr/0006-tier-2-console-network-consent-is-granted-only-by-the-first-run-modal-never-by-a-settings-toggle.md)
