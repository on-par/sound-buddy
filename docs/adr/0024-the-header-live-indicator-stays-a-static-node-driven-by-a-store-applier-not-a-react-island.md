# The header live indicator stays a static node driven by a store applier, not a React island

- Status: Accepted
- Date: 2026-08-15

## Context

In slice 6i the capture lifecycle moves out of inline-app.js into
capture-lifecycle.ts, and every post-capture chrome node becomes a React
island portaled from App.tsx (#live-status-island, #live-session-offers-island,
#window-badge-island). The header #live-indicator pill is the natural next
candidate for the same treatment. But the pill nests MeasurementBadge
(6h, #measurement-badge-island) and the #767 live-level readout inside
itself, and it lives in static root-markup. App.tsx mounts sibling islands
via createPortal into static containers; a portal target must already
exist in the DOM before the portal renders, and App's single render pass
cannot depend on a node owned by another mounted component. Turning the
pill into an island would therefore either move the nested badge/readout
out of it (changing the e2e-pinned markup and mount order) or require a
two-pass mount. The pure view + direct DOM applier (liveIndicatorView /
syncLiveIndicator) achieves the same discrete, unit-testable state split
the islands get, with none of the mount-order coupling.

## Decision

The #live-indicator pill stays a static root-markup node. capture-lifecycle.ts
exports the pure liveIndicatorView() view and a store-driven syncLiveIndicator()
applier that writes style.display, .live-txt text, and the capture-record
class from liveCaptureStore.isCapturing/liveMode/promoting at the same four
points inline-app.js called syncCaptureControls. No future renderer slice
(6j, 6k, or the final #424 inline-app.js deletion) may portal-replace
#live-indicator with a React island; the nested badge/readout islands keep
mounting inside the static pill, and the applier stays the pill's only writer.

## Consequences

Positive: the pill's state is derived through a pure, unit-tested view with
the same store discipline as every island, no portal/mount-order coupling,
and the e2e/static markup contract is unchanged. Negative: the pill is the
one node on this surface still written by imperative DOM calls from a
non-React module, so a future engineer must know to extend the applier
rather than reach for a portal when a new child needs to nest in the pill.

## References

- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [ADR-0014 — Live capture is always-monitoring and mode-less](docs/adr/0014-live-capture-is-always-monitoring-and-mode-less-transport-lives-only-in-the-persistent-top-bar.md)
- [ADR-0020 — The live capture workspace board renders from discrete store state](docs/adr/0020-the-live-capture-workspace-board-renders-from-discrete-store-state-per-tick-values-patch-straight-to-the-dom-via-the-existing-meter-controller-adr-0005-extension.md)
- [Issue #712](https://github.com/on-par/sound-buddy/issues/712)
