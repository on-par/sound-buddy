// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import {
  RTA_DISPLAY_MIN_HZ,
  RTA_DISPLAY_MAX_HZ,
  RTA_DISPLAY_ANCHOR_HZ,
  RTA_DISPLAY_BANDS_PER_OCTAVE,
  rtaDisplayBandCenters,
  RTA_DISPLAY_BAND_CENTERS,
  mapEngineCurveToDisplayGrid,
} from './rta-display-model';

describe('rta-display-model', () => {
  it('display grid band centers match iOS RTALayout.standard', () => {
    expect(RTA_DISPLAY_BAND_CENTERS.length).toBe(59);
    expect(RTA_DISPLAY_BAND_CENTERS[0]).toBeCloseTo(1000 * Math.pow(2, -33 / 6), 4);
    expect(RTA_DISPLAY_BAND_CENTERS[RTA_DISPLAY_BAND_CENTERS.length - 1]).toBeCloseTo(
      1000 * Math.pow(2, 25 / 6),
      2,
    );
    expect(RTA_DISPLAY_BAND_CENTERS[33]).toBeCloseTo(1000, 6);

    RTA_DISPLAY_BAND_CENTERS.forEach((center, i) => {
      expect(center).toBeCloseTo(RTA_DISPLAY_ANCHOR_HZ * Math.pow(2, (i - 33) / RTA_DISPLAY_BANDS_PER_OCTAVE), 6);
    });

    for (let i = 1; i < RTA_DISPLAY_BAND_CENTERS.length; i++) {
      const ratio = RTA_DISPLAY_BAND_CENTERS[i] / RTA_DISPLAY_BAND_CENTERS[i - 1];
      expect(ratio).toBeCloseTo(Math.pow(2, 1 / 6), 6);
    }

    RTA_DISPLAY_BAND_CENTERS.forEach((center) => {
      expect(center).toBeGreaterThanOrEqual(RTA_DISPLAY_MIN_HZ);
      expect(center).toBeLessThanOrEqual(RTA_DISPLAY_MAX_HZ);
    });

    const thirdOctave = rtaDisplayBandCenters(3);
    expect(thirdOctave[0]).toBeCloseTo(1000 * Math.pow(2, -16 / 3), 4);
  });

  it('grid mapping log-interpolates between engine points (hand-computed)', () => {
    const [mapped] = mapEngineCurveToDisplayGrid([100, 1000], [-20, -40], [250]);
    expect(mapped).toBeCloseTo(-27.9588, 4);

    const linearInHz = -20 + (-20) * ((250 - 100) / (1000 - 100));
    expect(mapped).not.toBeCloseTo(linearInHz, 2);
    expect(linearInHz).toBeCloseTo(-23.3333, 4);

    const [onPoint] = mapEngineCurveToDisplayGrid([100, 1000], [-20, -40], [1000]);
    expect(onPoint).toBeCloseTo(-40, 6);

    const engineDb = GRID_FREQS.map((_, i) => i);
    const mappedDefault = mapEngineCurveToDisplayGrid(GRID_FREQS, engineDb);
    const expectedAt1k = (47 * Math.log10(1000 / 20)) / 3;
    expect(mappedDefault[33]).toBeCloseTo(expectedAt1k, 3);
  });

  it('grid mapping clamps outside the engine range', () => {
    const [below, atLow, atHigh, above] = mapEngineCurveToDisplayGrid(
      [100, 1000],
      [-20, -40],
      [20, 100, 1000, 20000],
    );
    expect(below).toBeCloseTo(-20, 6);
    expect(atLow).toBeCloseTo(-20, 6);
    expect(atHigh).toBeCloseTo(-40, 6);
    expect(above).toBeCloseTo(-40, 6);
  });

  it('engine grid stays 48 points and is not mutated by the display grid mapping', () => {
    expect(GRID_FREQS.length).toBe(48);
    GRID_FREQS.forEach((f, i) => {
      expect(f).toBeCloseTo(20 * Math.pow(1000, i / 47), 6);
    });

    const freqsSnapshot = [...GRID_FREQS];
    const dbSnapshot = GRID_FREQS.map((_, i) => -i);

    const result = mapEngineCurveToDisplayGrid(freqsSnapshot, dbSnapshot);

    expect(GRID_FREQS).toEqual(freqsSnapshot);
    expect(freqsSnapshot).toEqual([...GRID_FREQS]);
    expect(dbSnapshot).toEqual(GRID_FREQS.map((_, i) => -i));
    expect(result.length).toBe(RTA_DISPLAY_BAND_CENTERS.length);
    expect(result.length).not.toBe(48);

    const frozenFreqs = Object.freeze([...GRID_FREQS]);
    const frozenDb = Object.freeze(GRID_FREQS.map((_, i) => -i));
    expect(() => mapEngineCurveToDisplayGrid(frozenFreqs, frozenDb)).not.toThrow();
  });

  it('grid mapping rejects mismatched lengths with an actionable error', () => {
    expect(() => mapEngineCurveToDisplayGrid([100, 200], [-10])).toThrow(RangeError);
    try {
      mapEngineCurveToDisplayGrid([100, 200], [-10]);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RangeError);
      expect((err as RangeError).message).toMatch(/matching/i);
      expect((err as RangeError).message).toMatch(/2/);
      expect((err as RangeError).message).toMatch(/1/);
    }
  });

  it('grid mapping skips non-finite points and returns -Infinity when none are usable', () => {
    const withGap = mapEngineCurveToDisplayGrid([100, 500, 1000], [-20, NaN, -40], [250, 700]);
    const withoutGap = mapEngineCurveToDisplayGrid([100, 1000], [-20, -40], [250, 700]);
    expect(withGap).toEqual(withoutGap);

    const sorted = mapEngineCurveToDisplayGrid([100, 500, 1000], [-20, -30, -40], [250]);
    const unsorted = mapEngineCurveToDisplayGrid([1000, 100, 500], [-40, -20, -30], [250]);
    expect(unsorted).toEqual(sorted);

    const allNaN = mapEngineCurveToDisplayGrid([100, 200], [NaN, NaN], [250, 300]);
    expect(allNaN).toEqual([-Infinity, -Infinity]);

    const empty = mapEngineCurveToDisplayGrid([], [], [250, 300]);
    expect(empty).toEqual([-Infinity, -Infinity]);

    const badFreqs = mapEngineCurveToDisplayGrid([-100, 0, NaN, Infinity, 500], [-1, -2, -3, -4, -30], [500]);
    expect(badFreqs).toEqual([-30]);
  });
});
