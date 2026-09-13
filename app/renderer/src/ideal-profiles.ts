// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure ideal-profile selection + curve-editor derivations (TD-001 slice 6b,
// #700) — a faithful port of inline-app.js's activeProfile/
// initIdealProfileSelect/selectedCustomProfile/openCurveEditor closures, now
// unit-tested and imported directly by idealProfilesStore.ts and the two
// React components instead of living in the classic-script closure. Imports
// the engine's PROFILES/defaultProfileForContentType straight from the
// package (like App.tsx), not via the window.audioEngineProfiles bridge —
// this module isn't a `?raw` classic script and can `import` normally.

import {
  PROFILES as AE_PROFILES,
  GRID_FREQS,
  defaultProfileForContentType as aeDefaultForContentType,
  defaultProfileForLiveCapture as aeDefaultForLiveCapture,
} from '@sound-buddy/audio-engine/dist/profiles/index.js';
import { hasUsableCurve, type IdealProfileLike, type SpectrumData } from './spectrum-display';
import type { CustomIdealProfile } from '../../electron/ipc/api';

const IP_BY_ID = new Map(AE_PROFILES.map((p) => [p.id, p]));
/** The #ideal-profile-select value prefix marking a user-authored custom profile. */
export const CUSTOM_PREFIX = 'custom:';

// The subset of window.idealCurves (ideal-curves.js, a classic UMD script)
// this module and idealProfilesStore.ts drive — injected as a dep rather
// than read off `window` directly (constitution: side effects are injected).
export interface IdealCurvesApi {
  clampDb(value: number): number;
  normalizeProfiles(raw: unknown, freqs: number[]): CustomIdealProfile[];
  bandOffsetsFromProfile(profile: IdealProfileLike | CustomIdealProfile | null, freqs: number[]): number[];
  profileFromBands(
    bands: number[],
    freqs: number[],
    meta: { id?: string; label: string; description?: string; createdAt?: string }
  ): CustomIdealProfile;
  profileFromMeasuredCurve(
    curve: { freqs: number[]; db: number[] } | undefined,
    freqs: number[],
    meta: { id?: string; label: string; description?: string; createdAt?: string }
  ): CustomIdealProfile | null;
  upsertProfile(profiles: CustomIdealProfile[], profile: CustomIdealProfile): CustomIdealProfile[];
  deleteProfile(profiles: CustomIdealProfile[], id: string): CustomIdealProfile[];
}

/** Strips the `custom:` value prefix used by the select's custom-profile options; '' if not a custom value. */
export function customProfileId(value: string): string {
  return String(value || '').startsWith(CUSTOM_PREFIX) ? String(value).slice(CUSTOM_PREFIX.length) : '';
}

/** '' (empty selection) means "auto by content type" — mirrors inline's `!idealProfileId`. */
export function isAutoSelected(selectedId: string): boolean {
  return !selectedId;
}

/** Resolve the profile to compare (and grade) against: an explicit pick, else
 *  auto by content type. Port of inline `activeProfile`. With NO file spectrum
 *  (a live capture, which has no content classifier) Auto resolves to the live
 *  default (worship service) rather than flat — see LIVE_CAPTURE_DEFAULT_PROFILE_ID. */
export function resolveActiveProfile(
  selectedId: string,
  customProfiles: CustomIdealProfile[],
  spectrum: { contentType?: string } | null
): IdealProfileLike {
  const customId = customProfileId(selectedId);
  if (customId) {
    const custom = customProfiles.find((p) => p.id === customId);
    // IdealProfileLike only names id/label/dbOffsets; `source` rides along on
    // the CustomIdealProfile shape (mirrors inline's `{...custom, source:'custom'}`).
    if (custom) return { ...custom, source: 'custom' } as IdealProfileLike & { source: 'custom' };
  }
  const auto = spectrum
    ? aeDefaultForContentType(spectrum.contentType as Parameters<typeof aeDefaultForContentType>[0])
    : aeDefaultForLiveCapture();
  const id = selectedId || auto;
  return IP_BY_ID.get(id) ?? (IP_BY_ID.get('flat') as IdealProfileLike);
}

/** The seven legacy band keys in editor order — the order profileFromBands /
 *  bandOffsetsFromProfile use (ideal-curves.js's BAND_KEYS). */
export const EDITOR_BAND_KEYS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance'] as const;

/** Level-matched relative offsets (dB) from a measured 7-band table — the live
 *  capture's equivalent of profileFromMeasuredCurve: subtract the mean of the
 *  finite bands so the shape is level-invariant, treat a missing/non-finite
 *  band as on-mean (0). Feeds profileFromBands to capture a live mix as an
 *  ideal curve. */
export function bandOffsetsFromMeasuredBands(bands: Record<string, number> | null | undefined): number[] {
  const values = EDITOR_BAND_KEYS.map((k) => (bands ? bands[k] : undefined));
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const mean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
  return values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round((v - mean) * 100) / 100 : 0));
}

/** Whether a live-capture 7-band table has enough finite bands to capture. */
export function hasUsableLiveBands(bands: Record<string, number> | null | undefined): boolean {
  if (!bands) return false;
  return EDITOR_BAND_KEYS.filter((k) => typeof bands[k] === 'number' && Number.isFinite(bands[k])).length >= 2;
}

/** The option model for #ideal-profile-select. Port of inline `initIdealProfileSelect`'s innerHTML. */
export function profileSelectOptions(
  customProfiles: CustomIdealProfile[]
): { value: string; label: string; group: 'builtin' | 'custom' | 'action' }[] {
  return [
    { value: '', label: 'Auto (by content)', group: 'builtin' },
    ...AE_PROFILES.map((p) => ({ value: p.id, label: p.label, group: 'builtin' as const })),
    ...customProfiles.map((p) => ({ value: `${CUSTOM_PREFIX}${p.id}`, label: p.label, group: 'custom' as const })),
    { value: '__new', label: 'Create new curve…', group: 'action' as const },
  ];
}

/** Port of inline `selectedCustomProfile`. */
export function selectedCustomProfile(selectedId: string, customProfiles: CustomIdealProfile[]): CustomIdealProfile | null {
  const id = customProfileId(selectedId);
  return id ? customProfiles.find((p) => p.id === id) ?? null : null;
}

/** Base profile the curve editor starts from: the selected custom profile, else the resolved active profile. Port of inline `curveEditorProfileBase`. */
function curveEditorProfileBase(
  selectedId: string,
  customProfiles: CustomIdealProfile[],
  spectrum: { contentType?: string } | null
): IdealProfileLike | CustomIdealProfile {
  return selectedCustomProfile(selectedId, customProfiles) ?? resolveActiveProfile(selectedId, customProfiles, spectrum);
}

/** Initial state for the curve editor dialog. Port of inline `openCurveEditor`. */
export function curveEditorInit(
  selectedId: string,
  customProfiles: CustomIdealProfile[],
  spectrum: SpectrumData | null,
  curves: IdealCurvesApi,
  liveBands: Record<string, number> | null = null,
): { editingId: string | null; title: string; name: string; canDelete: boolean; canCapture: boolean; bands: number[] } {
  const custom = selectedCustomProfile(selectedId, customProfiles);
  const base = curveEditorProfileBase(selectedId, customProfiles, spectrum);
  return {
    editingId: custom ? custom.id : null,
    title: custom ? 'Edit Ideal Curve' : 'Create Ideal Curve',
    name: custom ? custom.label : `Copy of ${base ? base.label : 'Flat / neutral'}`,
    canDelete: !!custom,
    // A file analysis with a fine curve, or a live capture with band levels —
    // either can be captured as the target.
    canCapture: !!(spectrum && hasUsableCurve(spectrum)) || hasUsableLiveBands(liveBands),
    bands: curves.bandOffsetsFromProfile(base, GRID_FREQS),
  };
}
