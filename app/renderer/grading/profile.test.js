import { describe, it, expect, afterEach } from 'vitest';

const grading = require('../grading.js');
const { makeSrc } = require('./fixtures.js');

// #266 — grading-strictness profiles. Every test in this file mutates the
// shared grading.js CONFIG singleton via setGradingProfile, so reset it back
// to 'casual' afterward to avoid leaking state into other test files/cases.
afterEach(() => grading.setGradingProfile('casual'));

describe('configForProfile (#266)', () => {
  it("'casual' deep-equals the original CONFIG exactly", () => {
    expect(grading.configForProfile('casual')).toEqual(grading.CONFIG);
  });

  it("'broadcast' shifts every grade/score-gating threshold by the documented offset", () => {
    expect(grading.configForProfile('broadcast')).toEqual({
      rms: { acceptableMin: -18, acceptableMax: -16, quietEdge: -23, hotEdge: -12 },
      peak: { issueAbove: -3, checkAbove: -5 },
      dynamicRange: { good: 8, check: 5 },
      bandBalance: { hotDiff: 10, severeHotDiff: 13, quietDiff: -15 },
      centroid: { min: 500, max: 4000 },
      lufs: { acceptableMin: -18, acceptableMax: -16, quietEdge: -23, hotEdge: -12 },
      truePeak: { ceiling: -3 },
    });
  });

  it('falls back to casual for an unknown profile id', () => {
    expect(grading.configForProfile('bogus-id')).toEqual(grading.configForProfile('casual'));
  });
});

describe('getGradingProfile (#266)', () => {
  it('defaults to casual', () => {
    expect(grading.getGradingProfile()).toEqual({ id: 'casual', label: 'Casual / volunteer' });
  });
});

describe('setGradingProfile (#266) — same fixture, both profiles', () => {
  it('shifts the grade and score for the same recording when switching profiles, and reverts on switch-back', () => {
    const src = makeSrc({ rms: -15 });

    grading.setGradingProfile('casual');
    expect(grading.getGradingProfile().id).toBe('casual');
    expect(grading.computeGrade(src)).toBe('A');
    expect(grading.computeScore(src)).toBe(99);

    grading.setGradingProfile('broadcast');
    expect(grading.getGradingProfile().id).toBe('broadcast');
    expect(grading.computeGrade(src)).toBe('B');
    expect(grading.computeScore(src)).toBe(89);

    grading.setGradingProfile('casual');
    expect(grading.getGradingProfile().id).toBe('casual');
    expect(grading.computeGrade(src)).toBe('A');
    expect(grading.computeScore(src)).toBe(99);
  });
});
