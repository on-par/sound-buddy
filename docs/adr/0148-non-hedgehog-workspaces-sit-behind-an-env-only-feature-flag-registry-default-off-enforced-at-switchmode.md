# Non-hedgehog workspaces sit behind an env-only feature-flag registry, default off, enforced at switchMode

- Status: Accepted
- Date: 2026-09-25

## Context

The 2026-09-25 product lock (#1518, #1520) says a FOH volunteer should get a simple app. The
non-hedgehog surfaces (Directory batch, Session DAW chrome, M32 Console, Build Guide, Ring Out and
the full Report Card view) stay in the codebase for later, but must be absent in production. The
existing advancedFeaturesEnabled setting cannot do this. It is user-toggleable, it has a derived
default of true for anyone with a saved rig or console consent, and it is persisted. Programmatic
navigation (RecentServicesPanel, BuildGuidePanel, LiveSessionOffers, onboarding, and a restored
lastAppMode) reaches workspaces without clicking a tab, so hiding tab buttons alone would leak the
flagged panels. Simple-mode History is implemented as a redirect to the 'recent' workspace.

## Decision

app/electron/feature-flags.ts is the single registry of feature flags. Every flag defaults to off
in all builds. The only override is the SOUND_BUDDY_FEATURES env var ("all" or a comma list of
ids), resolved in the main process and exposed read-only to the renderer over the
get-feature-flags IPC channel. Flags are never persisted to settings.json and have no UI toggle.
The renderer maps workspace modes to flags in simple-mode.ts (MODE_FLAGS / isModeFlagEnabled).
mode-switch.ts's switchMode is the single enforcement chokepoint: a flagged-off mode goes to
showAnalyzeStage before any side effect. ModeTabs additionally hides the flagged tab buttons.
The 'recent' workspace is deliberately unflagged because hedgehog History depends on it. New
non-hedgehog surfaces must add an id to FEATURE_FLAG_IDS and gate through this registry, not
through a new AppSettings boolean.

## Consequences

Positive: one place to see and flip every hidden surface. Production cannot reach a flagged panel
by any navigation path. Dev and e2e runs turn surfaces back on with a single env var, and nothing
is deleted. Negative: every Electron e2e launch that exercises a flagged surface must set
SOUND_BUDDY_FEATURES=all. Advanced-mode users lose Session/Console/Report Card until a flag is
promoted, which is the intended product lock. Deeper per-panel chrome inside hedgehog surfaces
(e.g. scene-change lines in results) is not yet flagged and needs follow-up ids in this same
registry.

## References

- [Issue #1520: Feature-flag registry + default-off for non-hedgehog UI](https://github.com/on-par/sound-buddy/issues/1520)
