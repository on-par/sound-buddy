// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { GRADING_RUBRIC_KEYS } from '../../electron/ipc/api';
import {
  RUBRIC_FIELDS,
  RUBRIC_GROUP_LABELS,
  CONFIG_RUBRIC_KEYS,
  rubricDefaultsFor,
  rubricFieldValue,
  rubricPatchFor,
  isOverridden,
  overrideCount,
  rubricInputId,
  rubricBounds,
  isCommittableDraft,
} from './grading-rubric';

const require = createRequire(import.meta.url);
const grading = require('../grading.js');

describe('RUBRIC_FIELDS', () => {
  it('has exactly one row per GRADING_RUBRIC_KEYS entry, in a known group, with a label/unit/hint', () => {
    expect(RUBRIC_FIELDS.map((f) => f.key).sort()).toEqual([...GRADING_RUBRIC_KEYS].sort());
    for (const f of RUBRIC_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.unit.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
      expect(f.step).toBeGreaterThan(0);
      expect(RUBRIC_GROUP_LABELS[f.group]).toBeDefined();
    }
  });

  it('every CONFIG-backed key is a real grading.js override path', () => {
    for (const key of CONFIG_RUBRIC_KEYS) expect(grading.RUBRIC_PATHS).toContain(key);
    expect(CONFIG_RUBRIC_KEYS).not.toContain('symptoms.thresholdOffsetDb');
  });
});

describe('rubricDefaultsFor', () => {
  it('reads the profile defaults from grading.js and pins the symptom offset at 0', () => {
    const d = rubricDefaultsFor(grading.rubricDefaults('casual'));
    expect(d['rms.acceptableMin']).toBe(-20);
    expect(d['bandBalance.severeHotDiff']).toBe(15);
    expect(d['symptoms.thresholdOffsetDb']).toBe(0);
    expect(rubricDefaultsFor(grading.rubricDefaults('broadcast'))['bandBalance.severeHotDiff']).toBe(13);
  });

  it('is null per CONFIG key when grading.js is unavailable, and still 0 for the symptom offset', () => {
    const d = rubricDefaultsFor(null);
    expect(d['rms.acceptableMin']).toBeNull();
    expect(d['symptoms.thresholdOffsetDb']).toBe(0);
    expect(rubricDefaultsFor({ 'rms.acceptableMin': Number.NaN })['rms.acceptableMin']).toBeNull();
  });
});

describe('rubricFieldValue / isOverridden / overrideCount', () => {
  const defaults = rubricDefaultsFor(grading.rubricDefaults('casual'));

  it('shows the override when set, else the default', () => {
    expect(rubricFieldValue({ 'rms.acceptableMin': -30 }, defaults, 'rms.acceptableMin')).toBe(-30);
    expect(rubricFieldValue({}, defaults, 'rms.acceptableMin')).toBe(-20);
    expect(rubricFieldValue(null, defaults, 'centroid.max')).toBe(4000);
    expect(isOverridden({ 'rms.acceptableMin': -30 }, 'rms.acceptableMin')).toBe(true);
    expect(isOverridden({ 'rms.acceptableMin': Number.NaN }, 'rms.acceptableMin')).toBe(false);
    expect(isOverridden(undefined, 'rms.acceptableMin')).toBe(false);
  });

  it('counts only finite overrides', () => {
    expect(overrideCount(null)).toBe(0);
    expect(overrideCount({ 'rms.acceptableMin': -30, 'centroid.max': 6000 })).toBe(2);
  });
});

describe('rubricPatchFor', () => {
  const defaults = rubricDefaultsFor(grading.rubricDefaults('casual'));

  it('sets a numeric edit and leaves other overrides alone', () => {
    const next = rubricPatchFor({ 'centroid.max': 6000 }, defaults, 'rms.acceptableMin', '-30');
    expect(next).toEqual({ 'centroid.max': 6000, 'rms.acceptableMin': -30 });
  });

  it('clears the override for a blank, non-numeric, or default-equal value', () => {
    const cur = { 'rms.acceptableMin': -30, 'centroid.max': 6000 };
    expect(rubricPatchFor(cur, defaults, 'rms.acceptableMin', '')).toEqual({ 'centroid.max': 6000 });
    expect(rubricPatchFor(cur, defaults, 'rms.acceptableMin', 'abc')).toEqual({ 'centroid.max': 6000 });
    expect(rubricPatchFor(cur, defaults, 'rms.acceptableMin', -20)).toEqual({ 'centroid.max': 6000 });
  });

  it('never mutates the input map', () => {
    const cur = { 'centroid.max': 6000 };
    rubricPatchFor(cur, defaults, 'centroid.max', '');
    expect(cur).toEqual({ 'centroid.max': 6000 });
  });
});

describe('rubricInputId', () => {
  it('dots become dashes', () => {
    expect(rubricInputId('bandBalance.severeHotDiff')).toBe('rubric-bandBalance-severeHotDiff');
  });
});

describe('rubricBounds / isCommittableDraft', () => {
  it('exposes the per-key span the main process enforces', () => {
    expect(rubricBounds('bandBalance.quietDiff')).toEqual({ min: -60, max: 0 });
    expect(rubricBounds('centroid.max')).toEqual({ min: 20, max: 20000 });
  });

  it('accepts blank and in-range numbers, rejects partial tokens and out-of-range values', () => {
    expect(isCommittableDraft('rms.acceptableMin', '')).toBe(true);
    expect(isCommittableDraft('rms.acceptableMin', '  ')).toBe(true);
    expect(isCommittableDraft('rms.acceptableMin', '-30')).toBe(true);
    expect(isCommittableDraft('rms.acceptableMin', '-')).toBe(false);
    expect(isCommittableDraft('rms.acceptableMin', '-.')).toBe(false);
    expect(isCommittableDraft('rms.acceptableMin', '5')).toBe(false);
    expect(isCommittableDraft('bandBalance.severeHotDiff', '-3')).toBe(false);
    expect(isCommittableDraft('symptoms.thresholdOffsetDb', '2.5')).toBe(true);
  });
});
