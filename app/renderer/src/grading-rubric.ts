// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure model for the Settings ▸ Grading ▸ Rubric editor: the field table the
// editor renders (one row per GRADING_RUBRIC_KEYS entry — the set the main
// process sanitizes, so the two can never drift), the displayed value per
// field (override, else the active strictness profile's default), and the
// next override map for an edit. The thresholds themselves stay in
// grading.js's CONFIG; this module only knows their paths and how to present
// them. No store or DOM access — GradingRubricEditor.tsx does the wiring.

import { GRADING_RUBRIC_KEYS, type GradingRubricKey, type GradingRubricOverrides } from '../../electron/ipc/api';

export type RubricGroup = 'level' | 'dynamics' | 'balance' | 'tone' | 'symptoms';

export interface RubricField {
  key: GradingRubricKey;
  label: string;
  unit: string;
  step: number;
  group: RubricGroup;
  /** One line shown as the input's title: what the number gates. */
  hint: string;
}

export const RUBRIC_GROUP_LABELS: Record<RubricGroup, string> = {
  level: 'Level',
  dynamics: 'Dynamics',
  balance: 'Band balance',
  tone: 'Tonal balance',
  symptoms: 'Tonal symptoms',
};

export const RUBRIC_FIELDS: readonly RubricField[] = [
  { key: 'rms.acceptableMin', label: 'RMS min', unit: 'dBFS', step: 1, group: 'level', hint: 'Quietest average level that still passes (live capture / files without loudness).' },
  { key: 'rms.acceptableMax', label: 'RMS max', unit: 'dBFS', step: 1, group: 'level', hint: 'Loudest average level that still passes.' },
  { key: 'lufs.acceptableMin', label: 'Loudness min', unit: 'LUFS', step: 1, group: 'level', hint: 'Quietest integrated loudness that still passes (files with an EBU R128 measurement).' },
  { key: 'lufs.acceptableMax', label: 'Loudness max', unit: 'LUFS', step: 1, group: 'level', hint: 'Loudest integrated loudness that still passes.' },
  { key: 'truePeak.ceiling', label: 'True-peak ceiling', unit: 'dBTP', step: 0.5, group: 'level', hint: 'Above this inter-sample peak the grade drops a letter.' },
  { key: 'dynamicRange.good', label: 'Dynamic range floor', unit: 'dB', step: 1, group: 'dynamics', hint: 'Below this the grade drops a letter (files only).' },
  { key: 'dynamicRange.check', label: 'Very compressed below', unit: 'dB', step: 1, group: 'dynamics', hint: 'Below this the score takes the larger dynamic-range penalty.' },
  { key: 'bandBalance.hotDiff', label: 'Band too hot', unit: 'dB', step: 1, group: 'balance', hint: 'A band this far above the ideal curve (vs. the other bands) reads Too Hot and gets a cut recommendation.' },
  { key: 'bandBalance.severeHotDiff', label: 'Band drops a letter', unit: 'dB', step: 1, group: 'balance', hint: 'A band this far above the ideal curve drops the grade a letter.' },
  { key: 'bandBalance.quietDiff', label: 'Band too quiet', unit: 'dB', step: 1, group: 'balance', hint: 'A band this far below the ideal curve reads Too Quiet (negative number).' },
  { key: 'centroid.min', label: 'Centroid min', unit: 'Hz', step: 50, group: 'tone', hint: 'Spectral centroid below this reads Check on the metrics table (not graded).' },
  { key: 'centroid.max', label: 'Centroid max', unit: 'Hz', step: 50, group: 'tone', hint: 'Spectral centroid above this reads Check on the metrics table (not graded).' },
  { key: 'symptoms.thresholdOffsetDb', label: 'Symptom sensitivity', unit: 'dB', step: 0.5, group: 'symptoms', hint: 'Added to every tonal-symptom threshold (Muddy, Harsh…): positive = fewer symptoms, negative = more.' },
];

/** The rubric thresholds that live in grading.js CONFIG (every key except the symptom offset). */
export const CONFIG_RUBRIC_KEYS: readonly GradingRubricKey[] = GRADING_RUBRIC_KEYS.filter((k) => k !== 'symptoms.thresholdOffsetDb');

/** Default value per key for a profile: grading.js's rubricDefaults plus the
 *  symptom offset (always 0 — it is not a CONFIG threshold). `configDefaults`
 *  is grading.rubricDefaults(profileId) or null when grading.js is unavailable. */
export function rubricDefaultsFor(configDefaults: Record<string, number> | null | undefined): Record<GradingRubricKey, number | null> {
  const out = {} as Record<GradingRubricKey, number | null>;
  for (const key of GRADING_RUBRIC_KEYS) {
    if (key === 'symptoms.thresholdOffsetDb') { out[key] = 0; continue; }
    const v = configDefaults ? configDefaults[key] : undefined;
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

/** True when the key carries a user override. */
export function isOverridden(overrides: GradingRubricOverrides | null | undefined, key: GradingRubricKey): boolean {
  const v = overrides?.[key];
  return typeof v === 'number' && Number.isFinite(v);
}

/** The value the editor shows: the override, else the profile default, else null (unknown). */
export function rubricFieldValue(
  overrides: GradingRubricOverrides | null | undefined,
  defaults: Record<GradingRubricKey, number | null>,
  key: GradingRubricKey,
): number | null {
  return isOverridden(overrides, key) ? (overrides![key] as number) : defaults[key];
}

/** The next override map after editing one field. A blank / non-numeric entry
 *  clears the override (back to the profile default); a value equal to the
 *  default also clears it, so the map only ever holds real deviations. */
export function rubricPatchFor(
  overrides: GradingRubricOverrides | null | undefined,
  defaults: Record<GradingRubricKey, number | null>,
  key: GradingRubricKey,
  rawValue: string | number,
): GradingRubricOverrides {
  const next: GradingRubricOverrides = { ...(overrides ?? {}) };
  const text = String(rawValue).trim();
  const n = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(n) || n === defaults[key]) {
    delete next[key];
  } else {
    next[key] = n;
  }
  return next;
}

/** Count of overridden fields — the "N customized" badge. */
export function overrideCount(overrides: GradingRubricOverrides | null | undefined): number {
  return GRADING_RUBRIC_KEYS.filter((k) => isOverridden(overrides, k)).length;
}

/** Stable element id for a field's input, e.g. "rubric-rms-acceptableMin". */
export function rubricInputId(key: GradingRubricKey): string {
  return `rubric-${key.replace(/\./g, '-')}`;
}
