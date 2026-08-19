# One committed scrubbed console capture is the cross-package fixture; unscrubbed captures are gitignored and CI-guarded

- Status: Accepted
- Date: 2026-08-19

## Context

The #848 discovery work produced a real 2103-line Midas M32R scene dump. Two packages need it
as an oracle: packages/console (scene-capture.ts must regenerate it line for line, per ADR-0071)
and packages/scene-inspector (parseScene/diffScenes must survive real hardware output, per #887
and #893). The obvious alternatives — copy the file into each package, or hoist it to a shared
top-level fixtures directory — either create two oracles that drift or break the relative reads
that packages/console's tests already rely on.
Separately, the raw capture from the console carries identifying material that was scrubbed
before commit. This repository is public and git history is permanent: a single accidental
`git add` of an unscrubbed capture cannot be walked back by deleting the file later. Until this
issue, nothing but human care stood in the way — .gitignore had no pattern for it and no test
checked.

## Decision

packages/console/src/capture-2026-08-16.scn is the single committed real-console capture. Other
packages read it in place by relative file URL (`new URL('../../console/src/capture-2026-08-16.scn',
import.meta.url)`) rather than copying it or relocating it. Unscrubbed captures are named
`*.local.scn`, that pattern is gitignored, and a guard test in
packages/scene-inspector/src/capture-fixture-hygiene.test.ts fails the build if any `*.local.scn`
path is tracked, if the .gitignore pattern is removed, or if the scrubbed capture stops being tracked.

## Consequences

Positive: one oracle, so packages/console and packages/scene-inspector can never disagree about
what real hardware emits; the privacy rule is enforced by CI instead of by memory; adding a third
consumer costs one relative URL.
Negative: scene-inspector's tests now have a filesystem-level dependency on a sibling package that
is not declared in its package.json, so moving or renaming the capture breaks tests in a package
that does not own it — the guard test's failure message must name the expected path so the break is
self-explaining. The hygiene guard also shells out to `git`, so it assumes a git checkout (true for
every CI run and every developer clone) rather than an exported tarball.

## References

- [Issue #893 — test: real-console .scn fixture in scene-inspector tests](https://github.com/patrob/sound-buddy/issues/893)
- [ADR-0071 — scene capture emits a generated fixture, pinned node path table](docs/adr/0071-scene-capture-emits-a-generated-fixture-pinned-node-path-table-and-refuses-to-write-a-partial-scn.md)
- [ADR-0070 — scene -oo levels parse to -Infinity and scene numeric equality is a NaN-safe helper](docs/adr/0070-scene-inf-levels-parse-to-infinity-and-scene-numeric-equality-is-a-nan-safe-helper.md)
- [Issue #893](https://github.com/on-par/sound-buddy/issues/893)
