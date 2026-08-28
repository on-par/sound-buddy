# E2e headless is an env-gated hidden main window behind one shared launch helper

- Status: Accepted
- Date: 2026-08-28

## Context

Playwright's `_electron.launch` has no `headless` option — Electron does
not implement Chromium's headless mode, and the documented CI answer
(xvfb) does not exist on macOS, where this project's e2e suite actually
runs. Until #1249 every spec called `_electron.launch` directly and got a
real, visible window, so `npm run test:e2e` opened windows on the dev Mac
and contradicted TESTS.md, CLAUDE.md's "E2e tests must run headless by
default" standard, and the constitution's headless-by-default contract.
Two forces shaped the fix: a paying customer's app must never be able to
boot with an invisible window, and a rule that is enforced per-spec drifts
the moment someone adds spec number fifteen.

## Decision

The Electron main process creates its BrowserWindow positioned off-screen
(`x: -10000, y: -10000`, still `show: true`) if and only if the environment
variable `SB_E2E_HEADLESS` is exactly `'1'`. The decision lives in
main.ts's pure, exported `getWindowOptions(preloadPath, env)`, which takes
the environment as an injected parameter and is unit-tested on both
branches; production behavior is unchanged because nothing outside the e2e
helper ever sets that variable. Every `_electron.launch` call in the repo
goes through `app/tests/launch-electron.ts`'s `launchElectron()`, which
injects `SB_E2E_HEADLESS=1` (merged into whatever env the caller supplied)
plus the Chromium anti-throttling switches, unless the runner's own env has
`SB_E2E_HEADED=1`. Headed mode is therefore opt-in for a human debugging
locally, headless is the default for every script and CI step, and a
Vitest guard (`app/electron/e2e-headless.test.ts`) fails the unit suite if
a spec calls `_electron.launch` directly or if `--headed`/`--ui`/`--debug`
appears in the e2e npm scripts. New specs must use the helper; they do not
get to pass their own launch options to Playwright.

**Superseded sub-decision:** the window was originally created with
`show: false` and `webPreferences.backgroundThrottling: false` instead of
off-screen positioning. That shipped green locally (macOS) but broke every
spec asserting on an rAF-driven UI loop (meters, transport readout,
playhead) under CI's `ubuntu-latest` + `xvfb-run` — reproduced in a
matching Ubuntu 24.04 + Node 22 + xvfb container. A `show: false` window
never gets a real compositor surface, so `requestAnimationFrame` stops
ticking regardless of `backgroundThrottling`, which only relaxes
`setTimeout`/`setInterval` clamping, not compositor paint scheduling.
Off-screen positioning keeps the window a normal, fully-composited,
`show: true` window — `requestAnimationFrame` ticks exactly as it did
before #1249 — while still never landing inside a real display's visible
bounds, so it doesn't steal focus or paint on top of other work locally.

## Consequences

Positive: e2e runs no longer steal focus or paint windows on the machine
running them; the headless claim in TESTS.md/README/CLAUDE.md becomes true
and is machine-enforced; the headless decision is a pure function with unit
tests instead of a Playwright config option that does not exist; the same
mechanism covers the packaged-app specs, which launch a real .app bundle
with a restricted env; because the window stays a real, fully-composited
window, rAF-driven UI (meters, transport, playhead) behaves identically to
headed mode, so there's no separate throttling behavior to keep in sync.
Negative: production main-process code now reads an env var that exists
only for tests (kept narrow: one exact-match comparison, SB_E2E_ prefixed,
no other effect); an off-screen window is still nominally "on screen" from
the OS's point of view, so on a machine with virtual desktops or unusual
multi-monitor layouts it could in principle become reachable (mitigated by
using a coordinate far outside any plausible display arrangement); and on
macOS the Dock icon still appears during a run even though no window is
visible. CI's existing `xvfb-run` wrapper on Linux is still required
(Electron needs a display server to launch on Linux at all, regardless of
window position) and is left alone (out of scope for #1249).

## References

- [Issue #1249 — test(e2e): run Playwright Electron headless by default](https://github.com/on-par/sound-buddy/issues/1249)
- [Electron BrowserWindow options (show, paintWhenInitiallyHidden, backgroundThrottling)](https://www.electronjs.org/docs/latest/api/browser-window)
