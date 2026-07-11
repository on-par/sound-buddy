import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { flatBands, makeSrc } = require('./fixtures.js');

describe('computeScore', () => {
  const BANDS = { A: [90, 99], B: [80, 89], C: [70, 79], D: [60, 69], F: [38, 55] };

  const inBand = (src) => {
    const grade = grading.computeGrade(src);
    const score = grading.computeScore(src);
    const [lo, hi] = BANDS[grade];
    expect(score).toBeGreaterThanOrEqual(lo);
    expect(score).toBeLessThanOrEqual(hi);
    return { grade, score };
  };

  it('sits at the top of the A band for a clean recording', () => {
    const { grade, score } = inBand(makeSrc());
    expect(grade).toBe('A');
    expect(score).toBe(99); // 100 clamped down into [90, 99]
  });

  it('clamps down into the letter band when raw penalties are too gentle', () => {
    // DR 4 drops one letter (→ B) but only costs 8 points → 92, clamped to 89.
    const src = makeSrc({ dynamicRange: 4 });
    expect(grading.computeGrade(src)).toBe('B');
    expect(grading.computeScore(src)).toBe(89);
  });

  it('clamps up into the letter band when raw penalties overshoot', () => {
    // rms -30 (out-of-band + very quiet), DR 2, band imbalance → three drops → D.
    // Raw 100 - 9 - 7 - 15 - 14 = 55, clamped UP into [60, 69] → 60.
    const bands = { ...flatBands(-30), mid: -8 };
    const src = makeSrc({ rms: -30, peak: -10, dynamicRange: 2, bands });
    expect(grading.computeGrade(src)).toBe('D');
    expect(grading.computeScore(src)).toBe(60);
  });

  it('keeps a clipping recording in the F band', () => {
    const { grade, score } = inBand(makeSrc({ clipping: true }));
    expect(grade).toBe('F');
    expect(score).toBeLessThanOrEqual(55);
  });

  it('never lets the score escape its grade band across the rule matrix', () => {
    const cases = [
      {},
      { clipping: true },
      { rms: -22 },
      { rms: -13 },
      { rms: -30, peak: -10 },
      { dynamicRange: 2 },
      { dynamicRange: 4 },
      { dynamicRange: null },
      { bands: { ...flatBands(-30), mid: -8 } },
      { contentType: 'music', peak: -8, dynamicRange: 20, rms: -30 },
      { peak: -20, rms: -40, dynamicRange: 2 },
    ];
    for (const over of cases) inBand(makeSrc(over));
  });
});
