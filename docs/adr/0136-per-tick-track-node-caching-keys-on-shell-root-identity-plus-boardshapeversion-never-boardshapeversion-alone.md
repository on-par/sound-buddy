# Per-tick track node caching keys on shell root identity plus boardShapeVersion, never boardShapeVersion alone

- Status: Accepted
- Date: 2026-09-12

## Context

`applyLiveTick` (`LiveWorkspace.tsx`) issued three `querySelector` calls per
track per frame — `.daw-track-head-name`, `.daw-lane-name`, and
`.daw-track-head-level-fill` via `patchTrackHeadLevels` — plus a `.daw-shell`
lookup and the transport chip/mix-lane lookups. As track count grows this cost
scales linearly with every animation frame, most of which patch the same
unchanged nodes.

The obvious cache key is `boardShapeVersion` — the store field ADR-0135
carved out specifically to signal "the board's SHAPE changed" — bumped only
when a track is added or removed (`liveCaptureStore.ts`). It is not
sufficient alone. `LiveCapturePanel` renders the whole board, `.daw-shell`
included, from one `dangerouslySetInnerHTML` string, re-assigned on *any*
discrete change: a rename, a selection change, mute/solo, a mains-hum badge
appearing. None of those bump `boardShapeVersion`, but each one detaches
every existing node in the subtree and replaces it with a fresh clone. A
cache keyed on `boardShapeVersion` alone would keep writing to those detached
orphans — the meters would silently freeze on the Live tab with no error and
no failing assertion, since the write itself still succeeds against a node
that is simply no longer on screen.

## Decision

`createTrackNodeCache` (`live-workspace-view.ts`) keys its memoized node map
on the pair `(root, boardShapeVersion)`, comparing `root` by reference
identity. `applyLiveTick` already re-resolves `.daw-shell` via
`body.querySelector('.daw-shell')` once per tick regardless — that lookup is
cheap (one call, not one per track) and existed before this change — so
passing that freshly-resolved root into `cache.scope(root, boardShapeVersion)`
surfaces a discrete-change rebuild for free: a new `.daw-shell` element fails
the identity check even when `boardShapeVersion` hasn't moved, and the cache
drops its stale entries and re-queries. `boardShapeVersion` alone would
under-invalidate; root identity alone would over-invalidate (misses the actual
optimization target — repeated ticks against a stable, unrebuilt board) and is
also strictly implied by `boardShapeVersion` changing, since a shape change
always accompanies a rebuild. Both together give the narrowest correct
invalidation the two already-cheap per-tick signals can express.

## Consequences

Positive: an unchanged board reuses every previously-queried track node
across ticks, so `applyLiveTick`'s DOM read cost stops scaling with frame
rate; the cache is a pure, injectable, unit-testable structure (plain-object
fakes, no jsdom) independent of the caching policy's correctness being
provable only via e2e.
Negative: any future board mutation that neither bumps `boardShapeVersion`
nor replaces the `.daw-shell` root node (a hypothetical in-place multi-field
mutation of the existing markup) would go uncaught by this invalidation and
must instead force a version bump or a root replacement — this constrains how
future per-tick patchers on this path may be implemented. Class-based hiding
(`body.not-pro`, `body.single-column`) is unrelated to this cache but shares
its non-goal: catching it would need a layout read this design deliberately
avoids for the sibling EQ-pane-visibility check landing in the same change.

## References

- [Issue #1413 — fix(live): cache live tick DOM nodes and skip hidden EQ pane work](https://github.com/on-par/sound-buddy/issues/1413)
- [Parent issue #1406 — Live tab monitoring performance](https://github.com/on-par/sound-buddy/issues/1406)
- [ADR-0135 — Live window ticks never enter the board shell's render selector](0135-live-window-ticks-never-enter-the-board-shell-s-render-selector.md)
