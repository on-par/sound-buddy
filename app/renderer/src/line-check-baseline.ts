// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Reads a per-strip captured ideal profile (lc-02, #1465) back out for
// grading (lc-03, #1466, epic #1462). lc-02 persists a captured curve as a
// CustomIdealProfile and records `custom:<id>` in the same per-device/
// per-strip-token override map instrument-profiles.js's effectiveProfileId
// resolves a built-in choice from — this module is the read side of that
// same map for the strip's ideal-curve baseline, not its instrument profile.
// Every miss (no override, a built-in preset override, a dangling id, or an
// unusable curve shape) resolves to null so the caller falls back to the
// context it already had (gradeContext.ts's forStrip).

import type { CustomIdealProfile } from '../../electron/ipc/api';
import { CUSTOM_PREFIX, customProfileId } from './ideal-profiles';
import { profileBaselineCurve } from './report-card';

/** Identifies one live-capture strip for the override-map lookup — the same
 *  (deviceName, token) pair line-check-capture.ts persists a capture under. */
export interface CapturedStripRef {
  deviceName: string;
  token: string;
}

/** The captured CustomIdealProfile for `strip`, or null when there is none:
 *  no override recorded, the override is a built-in instrument-profile id
 *  (not a `custom:` capture), the referenced profile id isn't in
 *  `customProfiles`, or its curve isn't usable (profileBaselineCurve). */
export function capturedStripProfile(
  overrides: Record<string, Record<string, string>> | null | undefined,
  customProfiles: CustomIdealProfile[],
  strip: CapturedStripRef,
): CustomIdealProfile | null {
  const value = (overrides || {})[strip.deviceName]?.[strip.token];
  if (typeof value !== 'string' || !value.startsWith(CUSTOM_PREFIX)) return null;
  const id = customProfileId(value);
  if (!id) return null;
  const profile = customProfiles.find((p) => p.id === id) ?? null;
  if (!profile || !profileBaselineCurve(profile)) return null;
  return profile;
}
