// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Gate for #1463 (epic #1462): lineCheckCalibrationEnabled is plumbing only in
// this slice. Nothing on the grading path may consult it until a later slice
// explicitly changes baseline selection — so evaluateRules keeps receiving the
// baseline it received before the flag existed. The scan lists the files
// explicitly (it never scans itself), so the token can be spelled literally.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRules } from '@sound-buddy/audio-engine/dist/analyze/rules.js';
import type { SpectrumCurve } from '@sound-buddy/audio-engine/dist/types.js';
import { symptomOptionsFor, gradeBaselineFor, symptomThresholdOffsetFrom, type GradeContext } from './report-card';

const GRADING_PATH_FILES = [
  'app/renderer/grading.js',
  'app/renderer/src/report-card.ts',
  'app/renderer/src/ReportCardIsland.tsx',
  'packages/audio-engine/src/analyze/rules.ts',
];

// Walk up from this file (app/renderer/src/) to the repo root.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('line-check calibration grading-path gate (#1463, epic #1462)', () => {
  it.each(GRADING_PATH_FILES)('%s exists and does not reference the dark flag', (relativePath) => {
    const fullPath = path.join(repoRoot, relativePath);
    expect(fs.existsSync(fullPath)).toBe(true);
    const text = fs.readFileSync(fullPath, 'utf8');
    expect(text).not.toContain('lineCheckCalibration');
  });

  // 60-250 Hz sits well above the 500 Hz-2 kHz body, firing the muddy rule
  // regardless of the flag — same fixture shape as report-card-symptom-grade.test.ts.
  const FREQS = [80, 200, 400, 800, 1600, 3000, 4200, 5000, 7000, 10000];
  const MUDDY_DB = [-21.3, -21.3, -30, -30, -30, -30, -30, -30, -30, -30];
  const PROFILE_DB = Array(FREQS.length).fill(-30);
  const curve: SpectrumCurve = { freqs: FREQS, db: MUDDY_DB };

  function contextWithFlag(lineCheckCalibrationEnabled: boolean): GradeContext {
    return {
      idealProfile: { id: 'flat', label: 'Flat reference', freqs: FREQS, dbOffsets: PROFILE_DB },
      isAutoProfile: false,
      symptomThresholdOffsetDb: 0,
      // Not a real GradeContext field — proves a stray flag on the context
      // object cannot change what symptomOptionsFor/evaluateRules produce.
      ...({ lineCheckCalibrationEnabled } as unknown as Record<string, never>),
    };
  }

  it('evaluateRules receives exactly the same options and fires the same rules whether the flag is on or off', () => {
    const ctxOff = contextWithFlag(false);
    const ctxOn = contextWithFlag(true);

    const optionsOff = symptomOptionsFor(ctxOff);
    const optionsOn = symptomOptionsFor(ctxOn);
    expect(optionsOff).toEqual(optionsOn);
    expect(optionsOff.baseline).not.toBeNull();

    const firedOff = evaluateRules(curve, undefined, optionsOff);
    const firedOn = evaluateRules(curve, undefined, optionsOn);
    expect(firedOff.length).toBeGreaterThan(0);
    expect(firedOff).toEqual(firedOn);

    expect(gradeBaselineFor(ctxOff)).toEqual(gradeBaselineFor(ctxOn));
  });

  it('symptomThresholdOffsetFrom ignores the flag on a settings-shaped object', () => {
    const base = { gradingRubric: { 'symptoms.thresholdOffsetDb': 2 } };
    const off = { ...base, lineCheckCalibrationEnabled: false };
    const on = { ...base, lineCheckCalibrationEnabled: true };
    expect(symptomThresholdOffsetFrom(off)).toBe(symptomThresholdOffsetFrom(on));
  });
});
