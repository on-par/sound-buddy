import { describe, it, expect } from 'vitest';
import {
  aWeightingDb,
  cWeightingDb,
  weightingDb,
  weightingCorrectionDb,
  createLevelSmoother,
  evaluateRange,
  meterPercent,
  SLOW_TIME_CONSTANT_MS,
  FAST_TIME_CONSTANT_MS,
} from './spl-meter';

describe('aWeightingDb', () => {
  it('is ~0 dB at 1 kHz', () => {
    expect(aWeightingDb(1000)).toBeCloseTo(0, 0.1);
  });

  it('is ~-19.1 dB at 100 Hz', () => {
    expect(Math.abs(aWeightingDb(100) - -19.1)).toBeLessThan(0.3);
  });

  it('is ~-2.5 dB at 10 kHz', () => {
    expect(Math.abs(aWeightingDb(10000) - -2.5)).toBeLessThan(0.3);
  });

  it('returns -Infinity for 0 Hz', () => {
    expect(aWeightingDb(0)).toBe(-Infinity);
  });

  it('returns -Infinity for negative Hz', () => {
    expect(aWeightingDb(-10)).toBe(-Infinity);
  });
});

describe('cWeightingDb', () => {
  it('is ~0 dB at 1 kHz', () => {
    expect(Math.abs(cWeightingDb(1000) - 0)).toBeLessThan(0.1);
  });

  it('is ~-0.3 dB at 100 Hz', () => {
    expect(Math.abs(cWeightingDb(100) - -0.3)).toBeLessThan(0.2);
  });

  it('is ~-4.4 dB at 10 kHz', () => {
    expect(Math.abs(cWeightingDb(10000) - -4.4)).toBeLessThan(0.3);
  });

  it('returns -Infinity for 0 Hz', () => {
    expect(cWeightingDb(0)).toBe(-Infinity);
  });

  it('returns -Infinity for negative Hz', () => {
    expect(cWeightingDb(-10)).toBe(-Infinity);
  });
});

describe('weightingDb', () => {
  it('returns 0 for Z-weighting at any frequency', () => {
    expect(weightingDb(20, 'Z')).toBe(0);
    expect(weightingDb(1000, 'Z')).toBe(0);
    expect(weightingDb(15000, 'Z')).toBe(0);
  });

  it('delegates to aWeightingDb for A-weighting', () => {
    expect(weightingDb(1000, 'A')).toBeCloseTo(aWeightingDb(1000), 5);
  });

  it('delegates to cWeightingDb for C-weighting', () => {
    expect(weightingDb(1000, 'C')).toBeCloseTo(cWeightingDb(1000), 5);
  });
});

describe('weightingCorrectionDb', () => {
  const binHz = 1000 / 44; // ~22.7 Hz per bin, so index 44 lands near 1000 Hz

  function spectrumWithHotBin(hotIndex: number, hotDb: number, length = 1024): Float64Array {
    const spectrum = new Float64Array(length).fill(-200);
    spectrum[hotIndex] = hotDb;
    return spectrum;
  }

  it('is ~0 for a hot bin near 1 kHz under A-weighting', () => {
    const spectrum = spectrumWithHotBin(44, -20);
    const correction = weightingCorrectionDb(spectrum, binHz, 'A');
    expect(Math.abs(correction - 0)).toBeLessThan(0.2);
  });

  it('is ~-19.1 for a hot bin near 100 Hz under A-weighting', () => {
    const hundredHzBinHz = 100 / 4;
    const spectrum = spectrumWithHotBin(4, -20, 2048);
    const correction = weightingCorrectionDb(spectrum, hundredHzBinHz, 'A');
    expect(Math.abs(correction - -19.1)).toBeLessThan(0.4);
  });

  it('returns exactly 0 for Z-weighting', () => {
    const spectrum = spectrumWithHotBin(44, -20);
    expect(weightingCorrectionDb(spectrum, binHz, 'Z')).toBe(0);
  });

  it('returns 0 for an all-silent spectrum', () => {
    const spectrum = new Float64Array(1024).fill(-Infinity);
    expect(weightingCorrectionDb(spectrum, binHz, 'A')).toBe(0);
  });

  it('excludes bins below 20 Hz (hot DC bin only yields 0 correction)', () => {
    // Every other bin is true silence (-Infinity, zero power) so the only
    // energy in the spectrum sits in the excluded DC bin — the passband sum
    // is exactly zero power, hitting the "spectrum sums to zero power" guard.
    const spectrum = new Float64Array(1024).fill(-Infinity);
    spectrum[0] = -20;
    expect(weightingCorrectionDb(spectrum, binHz, 'A')).toBe(0);
  });
});

describe('createLevelSmoother', () => {
  it('returns the input unchanged on the first update (seeds state)', () => {
    const smoother = createLevelSmoother(SLOW_TIME_CONSTANT_MS);
    expect(smoother.update(-40, 16)).toBe(-40);
  });

  it('reaches ~63.2% of a step after exactly one time constant (power domain)', () => {
    const smoother = createLevelSmoother(SLOW_TIME_CONSTANT_MS);
    smoother.update(-60, 16);
    const result = smoother.update(-20, SLOW_TIME_CONSTANT_MS);

    const startPower = Math.pow(10, -60 / 10);
    const targetPower = Math.pow(10, -20 / 10);
    const resultPower = Math.pow(10, result / 10);
    const fractionOfStepCovered = (resultPower - startPower) / (targetPower - startPower);

    expect(Math.abs(fractionOfStepCovered - (1 - Math.exp(-1)))).toBeLessThan(0.01);
  });

  it('returns the current state unchanged when dtMs <= 0', () => {
    const smoother = createLevelSmoother(FAST_TIME_CONSTANT_MS);
    smoother.update(-30, 16);
    expect(smoother.update(-10, 0)).toBe(-30);
    expect(smoother.update(-10, -5)).toBe(-30);
  });

  it('reset() re-seeds so the next update returns the input unchanged', () => {
    const smoother = createLevelSmoother(FAST_TIME_CONSTANT_MS);
    smoother.update(-30, 16);
    smoother.update(-10, 16);
    smoother.reset();
    expect(smoother.update(-5, 16)).toBe(-5);
  });

  it('converges to the input after many time constants', () => {
    const smoother = createLevelSmoother(FAST_TIME_CONSTANT_MS);
    smoother.update(-60, 16);
    let result = -60;
    for (let i = 0; i < 200; i += 1) {
      result = smoother.update(-10, FAST_TIME_CONSTANT_MS);
    }
    expect(Math.abs(result - -10)).toBeLessThan(0.05);
  });
});

describe('evaluateRange', () => {
  const range = { minDb: -22, maxDb: -8 };

  it('reports below when under minDb', () => {
    expect(evaluateRange(-30, range)).toBe('below');
  });

  it('reports inside when strictly within range', () => {
    expect(evaluateRange(-15, range)).toBe('inside');
  });

  it('reports above when over maxDb', () => {
    expect(evaluateRange(0, range)).toBe('above');
  });

  it('treats the minDb boundary as inside', () => {
    expect(evaluateRange(-22, range)).toBe('inside');
  });

  it('treats the maxDb boundary as inside', () => {
    expect(evaluateRange(-8, range)).toBe('inside');
  });
});

describe('meterPercent', () => {
  it('maps min to 0', () => {
    expect(meterPercent(-60, -60, 0)).toBe(0);
  });

  it('maps max to 100', () => {
    expect(meterPercent(0, -60, 0)).toBe(100);
  });

  it('maps the midpoint to 50', () => {
    expect(meterPercent(-30, -60, 0)).toBe(50);
  });

  it('clamps values below min to 0', () => {
    expect(meterPercent(-90, -60, 0)).toBe(0);
  });

  it('clamps values above max to 100', () => {
    expect(meterPercent(10, -60, 0)).toBe(100);
  });
});
