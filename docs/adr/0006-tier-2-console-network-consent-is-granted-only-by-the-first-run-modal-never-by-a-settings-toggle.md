# Tier 2 console-network consent is granted only by the first-run modal, never by a Settings toggle

- Status: Accepted
- Date: 2026-08-08

## Context

The council's unanimous #378 vote requires an "unmistakable opt-in (not just a
settings toggle)" for any feature that reads live data from a Midas console over
OSC/UDP — see docs/security/tier-1-tier-2-threat-model.md's Mitigation #1 and
Attack surface #7 (brand/privacy risk: silently normalizing console access would
undermine Sound Buddy's "fully local" claim). Every other experimental opt-in flag
in this app (dawWorkspaceEnabled, liveAdjustmentsEnabled, secondaryMeasurementEnabled,
crashReportingEnabled) is a plain Settings checkbox the user can check or uncheck
freely. Following that same pattern here — a checkbox defaulting off — would
technically satisfy "revocable in Settings" but would also let a user grant console
network access from Settings without ever seeing the scope-naming modal, which is
exactly what the council's Security Engineer flagged as the non-negotiable gate.
No Tier 2 feature exists yet to consume this gate (#371 and all four Tier-2
features are still blocked on the threat-model doc's sign-off checkbox), so this
decision is being made now as the shape every future Tier 2 feature (built in
later issues) must follow, before any of that code exists — reversing it later
would mean re-auditing every Tier 2 call site that assumed the modal-only
invariant.

## Decision

consoleNetworkConsentGranted can only ever be set to `true` by
consoleNetworkConsentStore's grant() action, which fires exclusively from the
ConsoleNetworkConsentDialog "Allow read-only access" button after the user has
seen the scope-naming copy. The Settings panel may only ever set it to `false`
(a "Revoke access" button, shown only when currently granted) — there is no
checkbox, switch, or any other Settings control capable of turning it on. Every
future Tier 2 main-process module must call assertConsoleNetworkConsent(settings)
before opening any socket, and every future Tier 2 renderer action must call
consoleNetworkConsentStore.requestConsent() before invoking that module's IPC
surface — requestConsent() shows the modal itself when consent isn't already
granted, so call sites never need to check the flag or render their own gate UI.

## Consequences

Positive: it is structurally impossible to grant Tier 2 console access without
seeing the exact-scope modal copy, satisfying the council's "unmistakable opt-in"
requirement by construction rather than by convention; future Tier 2 features get
a one-line integration (requestConsent() / assertConsoleNetworkConsent()) instead
of each reimplementing the check. Negative: this is an asymmetry from every other
experimental flag's UX (checkbox in, checkbox out) that a future contributor might
"fix" by adding a grant checkbox unless they read this ADR; the Settings copy must
keep explaining why the toggle is revoke-only. There is also currently no caller of
requestConsent()/assertConsoleNetworkConsent() (no Tier 2 feature ships yet), so
their only exercise is via unit tests until #371 or a Tier 2 feature issue lands.

## References

- [Issue #378](https://github.com/on-par/sound-buddy/issues/378)
- [Tier 1/Tier 2 threat model (#379)](https://github.com/on-par/sound-buddy/blob/main/docs/security/tier-1-tier-2-threat-model.md)
