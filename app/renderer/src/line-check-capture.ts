// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Per-strip capture-to-profile (lc-02, #1465, epic #1462): turns a captured
// line-check curve for the currently-checking strip (lc-01, #1464) into a
// CustomIdealProfile and persists it keyed the same way recordOverride keys a
// built-in profile choice — device name + strip token. The override value is
// a `custom:`-prefixed id (ideal-profiles.ts's CUSTOM_PREFIX), so
// effectiveProfileId resolves it through the exact same override-map lookup
// as a built-in preset, with no branching at the call site (see the widened
// isKnownProfileId in instrument-profiles.js). Nothing here touches the
// grading path or idealProfilesStore's saveMeasured — that also writes the
// global `idealProfile` selection, which would let a per-strip capture
// hijack it.

import type { CustomIdealProfile, UpdateSettingsPatch } from '../../electron/ipc/api';
import { CUSTOM_PREFIX, type IdealCurvesApi } from './ideal-profiles';

// The id format is `lc-<device slug>-<token slug>-<hash>`: the hash (not the
// slugs) is what guarantees two different (device, token) pairs never
// collide once both slugs are truncated to fit MAX_PROFILE_ID_LEN (64,
// enforced by both recordOverride and sanitizeInputInstrumentProfiles) —
// so it is never itself truncated.
const ID_PREFIX = 'lc-';
const HASH_LEN = 8;
// instrument-profiles.js's MAX_PROFILE_ID_LEN, minus CUSTOM_PREFIX — the
// budget for the id this module mints, before the caller adds `custom:`.
const MAX_CAPTURED_ID_LEN = 64 - CUSTOM_PREFIX.length;

function slugify(value: string, maxLen: number): string {
  const cleaned = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'x').slice(0, Math.max(1, maxLen));
}

// FNV-1a, 32-bit — small, dependency-free, and stable across Node/browser.
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(HASH_LEN, '0');
}

/** The deterministic captured-profile id for one (device, strip token) pair —
 *  stable across repeated calls, so re-capturing the same strip always
 *  targets the same id (AC3: overwrite, not duplicate). Fits within
 *  MAX_PROFILE_ID_LEN once the caller prefixes it with CUSTOM_PREFIX. */
export function capturedProfileId(deviceName: string, token: string): string {
  // JSON.stringify (not plain concatenation) so ('ab', 'c') and ('a', 'bc')
  // never hash to the same input.
  const hash = fnv1aHex(JSON.stringify([deviceName, token]));
  // -2 for the two separator dashes between prefix/deviceSlug/tokenSlug/hash.
  const slugBudget = MAX_CAPTURED_ID_LEN - ID_PREFIX.length - HASH_LEN - 2;
  const deviceBudget = Math.max(1, Math.floor(slugBudget / 2));
  const deviceSlug = slugify(deviceName, deviceBudget);
  const tokenSlug = slugify(token, Math.max(1, slugBudget - deviceSlug.length));
  return `${ID_PREFIX}${deviceSlug}-${tokenSlug}-${hash}`;
}

/** Builds the CustomIdealProfile for a line-check capture, or null when the
 *  curve is unusable (mirrors profileFromMeasuredCurve's own null case). */
export function buildLineCheckCaptureProfile(
  curve: { freqs: number[]; db: number[] } | undefined,
  freqs: number[],
  deviceName: string,
  token: string,
  stripLabel: string,
  curves: Pick<IdealCurvesApi, 'profileFromMeasuredCurve'>,
): CustomIdealProfile | null {
  return curves.profileFromMeasuredCurve(curve, freqs, {
    id: capturedProfileId(deviceName, token),
    label: `${stripLabel} (line check)`,
    description: `Captured from the ${stripLabel} line check`,
  });
}

export interface LineCheckCaptureDeps {
  getCurves(): IdealCurvesApi;
  getCustomProfiles(): CustomIdealProfile[];
  getOverrides(): Record<string, Record<string, string>> | null | undefined;
  recordOverride(
    all: Record<string, Record<string, string>> | null | undefined,
    deviceName: string,
    token: string,
    profileId: string,
  ): Record<string, Record<string, string>>;
  updateSettings(patch: UpdateSettingsPatch): Promise<unknown>;
}

/** Builds a captured profile from `curve` and persists it: the profile is
 *  upserted into the custom-profiles list (replacing any prior capture for
 *  this strip, AC3) and the override map records `custom:<id>` for this
 *  device + token (AC1, AC2) — one settings write for both. Returns false
 *  (and writes nothing) when the curve is unusable. */
export async function captureLineCheckProfile(
  curve: { freqs: number[]; db: number[] } | undefined,
  freqs: number[],
  deviceName: string,
  token: string,
  stripLabel: string,
  deps: LineCheckCaptureDeps,
): Promise<boolean> {
  const curves = deps.getCurves();
  const profile = buildLineCheckCaptureProfile(curve, freqs, deviceName, token, stripLabel, curves);
  if (!profile) return false;
  const customIdealProfiles = curves.upsertProfile(deps.getCustomProfiles(), profile);
  const inputInstrumentProfiles = deps.recordOverride(deps.getOverrides(), deviceName, token, `${CUSTOM_PREFIX}${profile.id}`);
  await deps.updateSettings({ customIdealProfiles, inputInstrumentProfiles });
  return true;
}
