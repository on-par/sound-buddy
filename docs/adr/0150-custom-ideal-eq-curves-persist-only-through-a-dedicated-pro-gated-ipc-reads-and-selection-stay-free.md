# Custom ideal EQ curves persist only through a dedicated Pro-gated IPC; reads and selection stay free

- Status: Accepted
- Date: 2026-09-25

## Context

#1523 makes custom EQ curves a Pro feature. Before this change the renderer wrote customIdealProfiles through
the generic update-settings IPC. That path whitelists keys by SETTING_SPECS.sanitizePatch, and
customIdealProfiles deliberately has none, so every custom curve was silently dropped and lost on relaunch.
The generic path also cannot express a license gate without special-casing one key. The app's license
doctrine (#54, #91, isEntitled) gates Pro features by feature flag in the main process, and never locks
user data a customer already created (save-rig: writes gated, reads ungated).

## Decision

Custom curves are written only via the dedicated `save-custom-ideal-profiles` IPC, which checks
isEntitled('custom-eq-curves') in the main process and delegates to settings.ts's saveCustomIdealProfiles.
'custom-eq-curves' is a PRO_FEATURES id, mirrored in license.ts, license-state.js and the no-usage-caps
allowlist. The generic update-settings path keeps rejecting customIdealProfiles. The renderer gates the
editor and every curve-write action on licenseStatus.tier === 'pro' and opens the license dialog when the
user is gated. Hydrating and selecting existing curves (built-in or custom) are never gated.

## Consequences

Custom curves survive relaunch, and the Pro gate is enforced where every other Pro write is enforced. Trial
and grace users keep editing. A lapsed user keeps using curves they already made but cannot edit or add
new ones. Any future curve writer (e.g. line-check capture) must route through saveCustomIdealProfiles
rather than update-settings. Adding the feature id means the three PRO_FEATURES mirrors must stay in sync.

## References

- [Issue #1523 — Pro: customizable EQ curves](https://github.com/on-par/sound-buddy/issues/1523)
