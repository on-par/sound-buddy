# Tier 2 consent grant is a dedicated IPC; the settings patch path is revoke-only

- Status: Accepted
- Date: 2026-08-14

## Context

ADR-0006 decided that consoleNetworkConsentGranted can only ever be set to
true by consoleNetworkConsentStore's grant() action (the first-run consent
modal), never by a Settings control, but that decision was enforced only
in the renderer UI: the generic update-settings IPC whitelist accepted
either boolean, and the renderer's grant() persisted true through
updateSettings({ consoleNetworkConsentGranted: true }).

Issue #747 collapses every AppSettings field's invariants into a per-field
spec (SETTING_SPECS) whose sanitizePatch is what the update-settings
whitelist derives from, and its acceptance criteria makes ADR-0006
non-negotiable at the main-process boundary: sanitizePatch for
consoleNetworkConsentGranted must explicitly reject true, with an explicit
test and a manual check that a true patch is dropped. That is only
satisfiable if grant() stops writing through the generic patch path — if
it kept doing so, the consent modal could never persist consent and the
whole Tier 2 consent gate would silently break. So the grant flow must be
rerouted to a dedicated main-side surface that is the only path capable of
writing true.

## Decision

consoleNetworkConsentGranted's SETTING_SPECS entry declares sanitizePatch =
(v) => v === false ? false : undefined, so the generic update-settings IPC
path can only ever revoke (write false). Granting is served by a dedicated
grant-console-network-consent IPC handler in ipc/settings.ts delegating to
settings.ts's new grantConsoleNetworkConsent() (which persists true through
the existing updateSettings/writeSettingsFile discipline). The renderer's
consoleNetworkConsentStore.grant() calls a new settingsStore
grantConsoleNetworkConsent() action (bridged over SettingsApi), which both
persists consent and updates the in-memory settings state so
requestConsent()'s already-granted fast path keeps working. Every future
Tier 2 renderer action that needs to (re)grant consent must go through
requestConsent() → grant() → grantConsoleNetworkConsent(); the generic
update-settings patch is permanently unable to set the flag to true.

## Consequences

The "Settings can only revoke, never grant" invariant now holds at the
main-process enforcement layer, not by renderer convention — a compromised
or malformed generic settings patch cannot grant console access. Future
Tier 2 work must know about the dedicated handler (one more IPC channel
than a naive "just add a settings flag" would suggest) and must not
"simplify" it back onto the patch path without re-auditing ADR-0006.
Renderer tests and the preload/mock bridges gain the new method, and the
consent store's deps drop the now-unused updateSettings injection.

## References

- [ADR-0006 — Tier 2 console-network consent is granted only by the first-run modal, never by a Settings toggle](docs/adr/0006-tier-2-console-network-consent-is-granted-only-by-the-first-run-modal-never-by-a-settings-toggle.md)
- [Issue #747](https://github.com/on-par/sound-buddy/issues/747)
