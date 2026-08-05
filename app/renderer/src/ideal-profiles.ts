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

/** Resolve the profile to compare against: an explicit pick, else auto by content type. Port of inline `activeProfile`. */
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
  const id = selectedId || aeDefaultForContentType(spectrum?.contentType as Parameters<typeof aeDefaultForContentType>[0]);
  return IP_BY_ID.get(id) ?? (IP_BY_ID.get('flat') as IdealProfileLike);
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
  curves: IdealCurvesApi
): { editingId: string | null; title: string; name: string; canDelete: boolean; canCapture: boolean; bands: number[] } {
  const custom = selectedCustomProfile(selectedId, customProfiles);
  const base = curveEditorProfileBase(selectedId, customProfiles, spectrum);
  return {
    editingId: custom ? custom.id : null,
    title: custom ? 'Edit Ideal Curve' : 'Create Ideal Curve',
    name: custom ? custom.label : `Copy of ${base ? base.label : 'Flat / neutral'}`,
    canDelete: !!custom,
    canCapture: !!(spectrum && hasUsableCurve(spectrum)),
    bands: curves.bandOffsetsFromProfile(base, GRID_FREQS),
  };
}
