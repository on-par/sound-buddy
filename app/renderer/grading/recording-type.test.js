import { describe, it, expect } from 'vitest';

// grading is a plain classic script (window.grading / module.exports), the same
// pattern as ideal-curves.js / license-state.js. Require it directly so these
// tests exercise the exact bytes the renderer loads via <script src>. The test
// file is .js (per #130) — Vitest picks it up via the renderer/**/*.test.js glob.
const grading = require('../grading.js');
const { flatBands, makeSrc } = require('./fixtures.js');

describe('bandDiffFromOthers', () => {
  it('is 0 when every band is equal', () => {
    expect(grading.bandDiffFromOthers(flatBands(), 'mid')).toBe(0);
  });

  it('measures a band against the mean of the others', () => {
    const bands = { ...flatBands(-30), mid: -10 };
    // others average -30; mid is 20 dB above them.
    expect(grading.bandDiffFromOthers(bands, 'mid')).toBeCloseTo(20, 5);
  });
});

describe('analyzeRecordingType', () => {
  it('flags clipping when the clipping flag is set', () => {
    expect(grading.analyzeRecordingType(makeSrc({ clipping: true })).type).toBe('clipping');
  });

  it('flags clipping when the peak reaches -0.5 dBFS', () => {
    expect(grading.analyzeRecordingType(makeSrc({ peak: -0.4 })).type).toBe('clipping');
  });

  it('flags a hot recording', () => {
    expect(grading.analyzeRecordingType(makeSrc({ peak: -2, rms: -10 })).type).toBe('hot');
  });

  it('recognises a dynamic service (music, healthy peaks, quiet whole-file RMS)', () => {
    const rt = grading.analyzeRecordingType(
      makeSrc({ contentType: 'music', peak: -8, dynamicRange: 20, rms: -30 }),
    );
    expect(rt.type).toBe('dynamic_service');
  });

  it('recognises low recording gain via the healthy-DR path', () => {
    const rt = grading.analyzeRecordingType(
      makeSrc({ peak: -10, rms: -33, dynamicRange: 20, contentType: 'speech' }),
    );
    expect(rt.type).toBe('low_gain');
  });

  it('recognises low recording gain via the very-low peak/RMS path', () => {
    const rt = grading.analyzeRecordingType(makeSrc({ peak: -20, rms: -40, dynamicRange: 2 }));
    expect(rt.type).toBe('low_gain');
  });

  it('flags a merely quiet recording', () => {
    expect(grading.analyzeRecordingType(makeSrc({ rms: -28, peak: -10 })).type).toBe('quiet');
  });

  it('reports a good level in the healthy window', () => {
    expect(grading.analyzeRecordingType(makeSrc({ rms: -15, peak: -4 })).type).toBe('good');
  });

  it('falls back to normal otherwise', () => {
    expect(grading.analyzeRecordingType(makeSrc()).type).toBe('normal');
  });
});
