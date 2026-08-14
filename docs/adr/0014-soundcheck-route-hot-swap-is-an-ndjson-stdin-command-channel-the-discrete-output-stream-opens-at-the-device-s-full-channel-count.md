# Soundcheck route hot-swap is an NDJSON stdin command channel; the discrete output stream opens at the device's full channel count

- Status: Accepted
- Date: 2026-08-14

## Context

#759 requires per-track output-routing changes to reach the running
playback.py without stopping, matching Live's ability to move outputs while
playing (device swap stays out of scope). Two forces drove the shape.
First, playback.py currently receives routing only as a one-time --route
startup arg, and the Electron->Python boundary has no parent->child request
path — stdout is child->parent only. ADR-0010 established that the python-
stream slot owns every Python child's lifecycle, so any new command path
belongs in that deep module, not a per-domain re-copy. Second, the
sounddevice OutputStream's channel count is fixed at open; a live route
change can therefore only address channels within the already-opened width.
Because the renderer's route dropdown already offers every device channel,
the discrete stream must be opened at the device's full max_output_channels
so that every dropdown choice (required <= device_channels by construction)
stays addressable without ever reopening the stream — a device-capability
ceiling, not a routing-dependent width.

## Decision

A running playback.py reads NDJSON command lines from stdin. The set-routes
command carries the full routing spec in the same grammar as --route,
revalidates it through the existing parse_route_spec, and atomically swaps
the lock-guarded route map the producer thread mixes every block; a
malformed command is logged to stderr and leaves the current routing in
effect. The python-stream slot gains send(data) and spawns all children with
stdin piped (['pipe','pipe','pipe']); the main process exposes a thin
set-playback-routes IPC handler that forwards the spec; soundcheckStore.
setRoute sends the full spec whenever playback is running. In discrete mode
the OutputStream opens at device max_output_channels (was `required`); the
master fold stays a startup decision, so no fold transition can occur at
runtime.

## Consequences

Positive: routing hot-swaps with zero stop/restart gap, the full in-device
output space is addressable live, fold semantics and the mixdown event are
unchanged, and the stdin channel gives future live-parameter hot-swap
commands a single transport seam owned by ADR-0010's slot. Negative: all
three slot consumers now spawn children with stdin piped (harmless — none
read it), a rejected command is invisible to the renderer (stderr only),
master-mode route edits have no audible effect (pre-existing master-wins
semantics), and the discrete stream is now as wide as the device even when
routing needs fewer channels.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/759)
- [ADR-0010 — python-stream slot owns child lifecycle](docs/adr/0010-python-child-process-stream-lifecycle-is-owned-by-one-deep-module-never-re-copied-per-domain.md)
