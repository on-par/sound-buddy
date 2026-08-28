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

The Electron main process creates its BrowserWindow with `show: false` and
`webPreferences.backgroundThrottling: false` if and only if the
environment variable `SB_E2E_HEADLESS` is exactly `'1'`. The decision lives
in main.ts's pure, exported `getWindowOptions(preloadPath, env)`, which
takes the environment as an injected parameter and is unit-tested on both
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

## Consequences

Positive: e2e runs no longer steal focus or paint windows on the machine
running them; the headless claim in TESTS.md/README/CLAUDE.md becomes true
and is machine-enforced; the headless decision is a pure function with unit
tests instead of a Playwright config option that does not exist; the same
mechanism covers the packaged-app specs, which launch a real .app bundle
with a restricted env.
Negative: production main-process code now reads an env var that exists
only for tests (kept narrow: one exact-match comparison, SB_E2E_ prefixed,
no other effect); a hidden window is a slightly different Chromium
lifecycle than a visible one, so background throttling has to be disabled
explicitly and a future rendering bug could in principle reproduce only in
headed mode; and on macOS the Dock icon still appears during a run even
though no window does. CI's existing `xvfb-run` wrapper on Linux becomes
redundant but is left alone (out of scope for #1249).

## References

- [Issue #1249 — test(e2e): run Playwright Electron headless by default](https://github.com/on-par/sound-buddy/issues/1249)
- [Electron BrowserWindow options (show, paintWhenInitiallyHidden, backgroundThrottling)](https://www.electronjs.org/docs/latest/api/browser-window)
