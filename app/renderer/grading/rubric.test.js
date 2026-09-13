import { describe, it, expect, afterEach } from 'vitest';

const grading = require('../grading.js');
const { makeSrc, flatBands } = require('./fixtures.js');

// User-editable rubric overrides: a flat map of CONFIG leaf paths to absolute
// values, layered over the active strictness profile. Every test mutates the
// shared CONFIG singleton, so reset both layers afterward.
afterEach(() => {
  grading.setRubricOverrides(null);
  grading.setGradingProfile('casual');
});

describe('rubricDefaults', () => {
  it('flattens every graded threshold of a profile to a "section.key" map', () => {
    const d = grading.rubricDefaults('casual');
    expect(d['rms.acceptableMin']).toBe(-20);
    expect(d['rms.acceptableMax']).toBe(-14);
    expect(d['bandBalance.hotDiff']).toBe(12);
    expect(d['bandBalance.severeHotDiff']).toBe(15);
    expect(d['bandBalance.quietDiff']).toBe(-15);
    expect(d['dynamicRange.good']).toBe(6);
    expect(d['dynamicRange.check']).toBe(3);
    expect(d['centroid.min']).toBe(500);
    expect(d['centroid.max']).toBe(4000);
    expect(d['lufs.acceptableMin']).toBe(-20);
    expect(d['lufs.acceptableMax']).toBe(-14);
    expect(d['truePeak.ceiling']).toBe(-1);
  });

  it('reflects the broadcast shift and ignores any active overrides', () => {
    grading.setRubricOverrides({ 'bandBalance.severeHotDiff': 30 });
    expect(grading.rubricDefaults('broadcast')['bandBalance.severeHotDiff']).toBe(13);
    expect(grading.rubricDefaults('casual')['bandBalance.severeHotDiff']).toBe(15);
  });
});

describe('setRubricOverrides', () => {
  it('replaces the named threshold and moves the grade, the reason, and the pill target together', () => {
    const src = makeSrc({ rms: -28 });
    expect(grading.computeGrade(src)).toBe('B');
    grading.setRubricOverrides({ 'rms.acceptableMin': -30 });
    expect(grading.CONFIG.rms.acceptableMin).toBe(-30);
    expect(grading.computeGrade(src)).toBe('A');
    expect(grading.explainGrade(src).deductions).toEqual([]);
    expect(grading.rcMetricTarget('rms')).toBe('-30 to -14 dBFS');
    expect(grading.rcRmsStatus(-28)).toBe('good');
  });

  it('widens the band-balance tolerance so a hotter band passes', () => {
    const src = makeSrc({ bands: { ...flatBands(-30), mid: -12 } }); // +21 dB
    expect(grading.computeGrade(src)).toBe('B');
    grading.setRubricOverrides({ 'bandBalance.severeHotDiff': 25, 'bandBalance.hotDiff': 22 });
    expect(grading.computeGrade(src)).toBe('A');
    expect(grading.computeRecommendations(src)).not.toContain(
      'Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range.',
    );
  });

  it('survives a strictness-profile switch: the profile shifts un-overridden keys, the override stays absolute', () => {
    grading.setRubricOverrides({ 'rms.acceptableMin': -30 });
    grading.setGradingProfile('broadcast');
    expect(grading.CONFIG.rms.acceptableMin).toBe(-30);
    expect(grading.CONFIG.rms.acceptableMax).toBe(-16);
    expect(grading.CONFIG.bandBalance.severeHotDiff).toBe(13);
    grading.setGradingProfile('casual');
    expect(grading.CONFIG.rms.acceptableMin).toBe(-30);
    expect(grading.CONFIG.bandBalance.severeHotDiff).toBe(15);
  });

  it('ignores unknown paths and non-finite values', () => {
    grading.setRubricOverrides({ 'rms.bogus': 1, 'nope.acceptableMin': 2, 'rms.acceptableMax': Number.NaN, 'rms.acceptableMin': '-30' });
    expect(grading.CONFIG).toEqual(grading.configForProfile('casual', null));
    expect(grading.getRubricOverrides()).toEqual({});
  });

  it('null, undefined, or {} clears every override back to the profile defaults', () => {
    grading.setRubricOverrides({ 'dynamicRange.good': 12 });
    expect(grading.CONFIG.dynamicRange.good).toBe(12);
    grading.setRubricOverrides({});
    expect(grading.CONFIG.dynamicRange.good).toBe(6);
    grading.setRubricOverrides({ 'dynamicRange.good': 12 });
    grading.setRubricOverrides(undefined);
    expect(grading.CONFIG.dynamicRange.good).toBe(6);
  });

  it('never compounds: re-applying the same overrides is idempotent', () => {
    grading.setRubricOverrides({ 'centroid.max': 6000 });
    grading.setRubricOverrides({ 'centroid.max': 6000 });
    grading.setGradingProfile('broadcast');
    grading.setGradingProfile('broadcast');
    expect(grading.CONFIG.centroid.max).toBe(6000);
    expect(grading.CONFIG.rms.acceptableMin).toBe(-18);
  });

  it('getRubricOverrides returns a defensive copy of only the accepted keys', () => {
    grading.setRubricOverrides({ 'centroid.max': 6000, 'junk.key': 5 });
    const o = grading.getRubricOverrides();
    expect(o).toEqual({ 'centroid.max': 6000 });
    o['centroid.max'] = 1;
    expect(grading.getRubricOverrides()['centroid.max']).toBe(6000);
  });

  it('configForProfile(id, overrides) is pure and never touches CONFIG', () => {
    const before = JSON.parse(JSON.stringify(grading.CONFIG));
    const cfg = grading.configForProfile('casual', { 'truePeak.ceiling': -3 });
    expect(cfg.truePeak.ceiling).toBe(-3);
    expect(grading.CONFIG).toEqual(before);
  });
});

describe('configForProfile repairs paired-threshold ordering', () => {
  it('swaps an rms min override that crosses the profile max, so a level rule can never fail every recording', () => {
    grading.setRubricOverrides({ 'rms.acceptableMin': -10 });
    expect(grading.CONFIG.rms.acceptableMin).toBe(-14);
    expect(grading.CONFIG.rms.acceptableMax).toBe(-10);
    expect(grading.CONFIG.rms.hotEdge).toBe(-10);
    expect(grading.computeGrade(makeSrc({ rms: -12 }))).toBe('A');
  });

  it('pushes the score-only edges out to a widened acceptable band instead of fighting the override', () => {
    grading.setRubricOverrides({ 'rms.acceptableMin': -30, 'lufs.acceptableMax': -8 });
    expect(grading.CONFIG.rms).toMatchObject({ acceptableMin: -30, quietEdge: -30, acceptableMax: -14, hotEdge: -10 });
    expect(grading.CONFIG.lufs).toMatchObject({ acceptableMax: -8, hotEdge: -8, acceptableMin: -20, quietEdge: -25 });
  });

  it('keeps hotDiff ≤ severeHotDiff, check ≤ good, and centroid min ≤ max', () => {
    grading.setRubricOverrides({ 'bandBalance.hotDiff': 20, 'dynamicRange.check': 9, 'centroid.min': 5000 });
    expect(grading.CONFIG.bandBalance).toMatchObject({ hotDiff: 15, severeHotDiff: 20 });
    expect(grading.CONFIG.dynamicRange).toEqual({ good: 9, check: 6 });
    expect(grading.CONFIG.centroid).toEqual({ min: 4000, max: 5000 });
  });

  it('leaves an already-ordered config untouched', () => {
    expect(grading.configForProfile('casual', null)).toEqual(grading.configForProfile('casual', {}));
    expect(grading.configForProfile('broadcast', null).rms).toEqual({ acceptableMin: -18, acceptableMax: -16, quietEdge: -23, hotEdge: -12 });
  });
});
