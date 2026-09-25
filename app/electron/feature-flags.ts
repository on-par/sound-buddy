// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// #1520: the single registry of feature flags gating the non-hedgehog
// workspaces. Every flag defaults to OFF in every build (packaged and
// unpackaged alike) — the only way to turn one on is the SOUND_BUDDY_FEATURES
// env var at launch. Flags are never persisted to settings.json and have no
// UI toggle; see mode-switch.ts's switchMode and ModeTabs.tsx for the two
// enforcement points that read the resolved FeatureFlags.
//
// Each id gates one workspace surface:
//   reportCard — the full Report Card workspace (mode-switch.ts's 'reportcard')
//   directory  — the Directory batch-analysis workspace ('dir')
//   session    — the Session live DAW chrome ('live')
//   console    — the M32/X32 Console workspace ('console')
//   buildGuide — the Build Guide workspace ('guide')
//   ringOut    — the Ring Out workspace ('ringout')
export const FEATURE_FLAG_IDS = ['reportCard', 'directory', 'session', 'console', 'buildGuide', 'ringOut'] as const;

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];

export type FeatureFlags = Readonly<Record<FeatureFlagId, boolean>>;

/** The only env var that can turn a flag on — see resolveFeatureFlags. */
export const FEATURE_FLAGS_ENV = 'SOUND_BUDDY_FEATURES';

/** Turns every flag on when present as a token (case-insensitive). */
const ALL_TOKEN = 'all';

export const ALL_FEATURE_FLAGS_OFF: FeatureFlags = Object.freeze({
  reportCard: false,
  directory: false,
  session: false,
  console: false,
  buildGuide: false,
  ringOut: false,
});

/**
 * Resolves the launch-time feature-flag set from `env[FEATURE_FLAGS_ENV]`.
 * A missing/empty value returns every flag off. The value is split on
 * whitespace/commas, trimmed, and lowercased; the special `all` token turns
 * every flag on, otherwise a flag is on only when its lowercased id appears
 * in the token set. Unknown tokens are ignored. Always returns a fresh
 * frozen object — never a shared mutable instance.
 */
export function resolveFeatureFlags(env: Readonly<Record<string, string | undefined>>): FeatureFlags {
  const raw = env[FEATURE_FLAGS_ENV]?.trim();
  if (!raw) return Object.freeze({ ...ALL_FEATURE_FLAGS_OFF });

  const tokens = new Set(raw.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter((t) => t !== ''));
  const allOn = tokens.has(ALL_TOKEN);

  return Object.freeze(
    Object.fromEntries(
      FEATURE_FLAG_IDS.map((id) => [id, allOn || tokens.has(id.toLowerCase())]),
    ) as Record<FeatureFlagId, boolean>,
  );
}
