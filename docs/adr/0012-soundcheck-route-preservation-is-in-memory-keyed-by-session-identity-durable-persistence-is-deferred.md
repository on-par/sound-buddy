# Soundcheck route preservation is in-memory, keyed by session identity; durable persistence is deferred

- Status: Accepted
- Date: 2026-08-11

## Context

Issue #755: re-importing a multi-track session in the Virtual Soundcheck
tab reset the user's per-track output-channel routing to sequential
defaults, because `chooseSession` always reseeded `routes` from
`defaultRoutes(manifest.tracks)`. Routes are purely in-memory state — they
are never written to settings (confirmed: no `routes` key in
app/electron/settings.ts) — so there is nothing to restore across app
restarts. The issue scopes the fix to the default-channel-on-reimport
regression and explicitly puts broader saved-routing persistence out of
scope, to be tracked separately alongside #754 and the saved-routing
request (which share this "routing not persisted" root cause).

## Decision

`chooseSession` preserves the current in-memory `routes` only when the
dialog returns the already-loaded session directory AND the newly-read
manifest has an identical track shape (via the pure `sameTrackShape`
helper); every other import seeds `defaultRoutes`. No AppSettings field,
IPC change, or migration is introduced — routing is not persisted to disk.
Durable, cross-restart saved routing remains future work under #754 / the
saved-routing request and, if built, must not reintroduce the reseed clobber.

## Consequences

Positive: the reported regression is fixed with a small, well-contained
change; no settings schema churn; the persistence decision is deferred to
a change that can design it properly. Negative: custom routing still does
not survive quitting the app or closing the session — a known, documented
limitation until the saved-routing work lands.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/755)
- [Issue](https://github.com/on-par/sound-buddy/issues/754)
