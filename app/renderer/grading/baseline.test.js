import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { makeSrc, flatBands } = require('./fixtures.js');

// Band balance measured against an ideal-curve baseline instead of a flat
// reference. `src.baseline` carries the resolved 7-band targets (relative dB)
// of the active ideal profile plus its label; a source without one grades
// exactly as before (flat reference).

// A pink-tilted full-range mix: power density falls ~3 dB/octave, so the seven
// bands step down from sub-bass to brilliance. Against a flat reference this
// reads as "+15.5 dB band imbalance" and drops a letter, even though the mix
// is textbook-balanced for music.
const PINK_BANDS = { subBass: -60, bass: -64.9, lowMid: -69.7, mid: -74, highMid: -78.8, presence: -81, brilliance: -84.8 };
// The same shape expressed as relative targets (level-invariant).
const PINK_TARGETS = { subBass: 12, bass: 7.1, lowMid: 2.3, mid: -2, highMid: -6.8, presence: -9, brilliance: -12.8 };
const BASELINE = { label: 'Worship service', bandTargets: PINK_TARGETS };

// The crowd-mic live window from the report that motivated this rubric change
// (window #135) and the worship-service profile's 7-band targets exactly as
// bandTargetsFromProfile derives them (see grading.golden.json's
// baseline_worship_live fixture, generated from the engine).
const CROWD_MIC_BANDS = { subBass: -61.1, bass: -63.0, lowMid: -71.2, mid: -76.6, highMid: -96.0, presence: -92.5, brilliance: -104.1 };
const WORSHIP_TARGETS = { subBass: 16.1, bass: 12.9, lowMid: 6.5, mid: 2.9, highMid: -9.2, presence: -14.3, brilliance: -17.5 };

describe('bandDiffFromOthers with targets', () => {
  it('is byte-identical to the flat reference when no targets are given', () => {
    const bands = { ...flatBands(-30), mid: -18 };
    expect(grading.bandDiffFromOthers(bands, 'mid')).toBeCloseTo(12, 6);
    expect(grading.bandDiffFromOthers(bands, 'mid', null)).toBeCloseTo(12, 6);
    expect(grading.bandDiffFromOthers(bands, 'mid', undefined)).toBeCloseTo(12, 6);
  });

  it('reads zero for every band when the bands match the target shape, at any level', () => {
    for (const key of Object.keys(PINK_BANDS)) {
      expect(grading.bandDiffFromOthers(PINK_BANDS, key, PINK_TARGETS)).toBeCloseTo(0, 6);
      const louder = Object.fromEntries(Object.entries(PINK_BANDS).map(([k, v]) => [k, v + 20]));
      expect(grading.bandDiffFromOthers(louder, key, PINK_TARGETS)).toBeCloseTo(0, 6);
    }
  });

  it('measures excess over the target, not over the other bands', () => {
    const bands = { ...PINK_BANDS, bass: PINK_BANDS.bass + 7 };
    // 7 dB over target in one band; the other six deviations are all 0, so
    // the diff is exactly the band's own excess.
    expect(grading.bandDiffFromOthers(bands, 'bass', PINK_TARGETS)).toBeCloseTo(7, 6);
  });

  it('treats a missing or non-finite target for a band as 0 dB', () => {
    const bands = { ...flatBands(-30), mid: -18 };
    expect(grading.bandDiffFromOthers(bands, 'mid', { mid: Number.NaN })).toBeCloseTo(12, 6);
    expect(grading.bandDiffFromOthers(bands, 'mid', {})).toBeCloseTo(12, 6);
  });
});

describe('grade against an ideal-curve baseline', () => {
  it('a pink-tilted music mix loses a letter against the flat reference', () => {
    const src = makeSrc({ bands: PINK_BANDS });
    expect(grading.computeGrade(src)).toBe('B');
    expect(grading.explainGrade(src).deductions.map((d) => d.rule)).toEqual(['Band imbalance']);
  });

  it('the same mix grades clean against a matching baseline', () => {
    const src = makeSrc({ bands: PINK_BANDS, baseline: BASELINE });
    expect(grading.computeGrade(src)).toBe('A');
    expect(grading.explainGrade(src).deductions).toEqual([]);
    expect(grading.computeScore(src)).toBe(99);
    expect(grading.computeRecommendations(src)).toEqual([
      'Great job! No major issues detected — levels and balance are solid.',
    ]);
  });

  it('names the baseline in the deduction when a band really is hot against it', () => {
    const src = makeSrc({ bands: { ...PINK_BANDS, lowMid: PINK_BANDS.lowMid + 16 }, baseline: BASELINE });
    expect(grading.computeGrade(src)).toBe('B');
    const [d] = grading.explainGrade(src).deductions;
    expect(d.rule).toBe('Band imbalance');
    expect(d.measured).toBe('+16.0 dB');
    expect(d.target).toBe('≤ +15 dB vs. Worship service');
    expect(d.letterImpact).toBe('Drops one letter');
    expect(grading.computeRecommendations(src)).toContain(
      'Too much energy in Low-mid (250-500 Hz). Cut 10.0 dB around this range.',
    );
  });

  it('keeps the legacy wording when the source has no baseline', () => {
    const src = makeSrc({ bands: { ...flatBands(-30), mid: -8 } });
    const [d] = grading.explainGrade(src).deductions;
    expect(d.measured).toBe('+22.0 dB');
    expect(d.target).toBe('≤ +15 dB vs. other bands');
  });

  it('falls back to the flat reference when baseline has no usable targets', () => {
    const src = makeSrc({ bands: PINK_BANDS, baseline: { label: 'Broken', bandTargets: null } });
    expect(grading.computeGrade(src)).toBe('B');
    const [d] = grading.explainGrade(src).deductions;
    expect(d.target).toBe('≤ +15 dB vs. other bands');
  });

  it('the crowd-mic live window that graded C reads balanced against the worship-service curve', () => {
    const live = { rms: -37.6, peak: -26.2, dynamicRange: null, clipping: false, centroid: 153, bands: CROWD_MIC_BANDS };
    // Flat reference: +22.8 dB "imbalance" and a dropped letter.
    expect(grading.explainGrade(live).deductions.map((d) => d.rule)).toEqual(['Band imbalance']);
    expect(grading.computeGrade(live)).toBe('B');
    // Worship-service baseline: every band within tolerance, no band deduction.
    const graded = { ...live, baseline: { label: 'Worship service', bandTargets: WORSHIP_TARGETS } };
    expect(grading.explainGrade(graded).deductions).toEqual([]);
    expect(grading.computeGrade(graded)).toBe('A');
    const recs = grading.computeRecommendations(graded);
    expect(recs.some((r) => r.startsWith('Too much energy'))).toBe(false);
    expect(recs).not.toContain('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
  });
});

describe('recommendations are baseline-relative', () => {
  it('"lacks air" fires when brilliance sits well below the baseline-relative others, not on an absolute level', () => {
    // A quiet but balanced recording: every band far below -40 dBFS, all on target.
    const quiet = Object.fromEntries(Object.entries(PINK_BANDS).map(([k, v]) => [k, v - 30]));
    expect(grading.computeRecommendations(makeSrc({ bands: quiet, baseline: BASELINE })))
      .not.toContain('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
    // Genuinely dull: brilliance 20 dB under the target shape.
    const dull = { ...PINK_BANDS, brilliance: PINK_BANDS.brilliance - 20 };
    expect(grading.computeRecommendations(makeSrc({ bands: dull, baseline: BASELINE })))
      .toContain('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
  });

  it('attributes a baseline-relative hot band to the loudest live channel', () => {
    const src = makeSrc({
      bands: { ...PINK_BANDS, bass: PINK_BANDS.bass + 14 },
      baseline: BASELINE,
      channels: [
        { name: 'Vox', bands: { ...PINK_BANDS } },
        { name: 'Kick', bands: { ...PINK_BANDS, bass: -40 } },
      ],
    });
    expect(grading.computeRecommendations(src)).toContain(
      'Too much energy in Bass (60-250 Hz). Cut 10.0 dB around this range. Mostly coming from "Kick".',
    );
  });
});
