import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { flatBands, makeSrc } = require('./fixtures.js');

describe('computeRecommendations', () => {
  it('leads with the critical clipping warning', () => {
    const recs = grading.computeRecommendations(makeSrc({ clipping: true }));
    expect(recs[0]).toBe('CRITICAL: Clipping detected. Reduce input gain immediately.');
  });

  it('surfaces the recording-type note for a low-gain take', () => {
    const src = makeSrc({ peak: -10, rms: -33, dynamicRange: 20, contentType: 'speech' });
    const note = grading.analyzeRecordingType(src).note;
    expect(grading.computeRecommendations(src)).toContain(note);
  });

  it('warns when the recording is too hot', () => {
    const recs = grading.computeRecommendations(makeSrc({ rms: -8, peak: -10 }));
    expect(recs).toContain('Your recording is too hot. Reduce gain to avoid clipping.');
  });

  it('warns when the recording is too quiet', () => {
    const recs = grading.computeRecommendations(makeSrc({ rms: -30, peak: -10 }));
    expect(recs).toContain('Your recording is too quiet. Increase input gain or fader levels.');
  });

  it('warns about a compressed dynamic range', () => {
    const recs = grading.computeRecommendations(makeSrc({ dynamicRange: 2 }));
    expect(recs).toContain('Dynamic range is very compressed. Mix may sound lifeless.');
  });

  it('warns about excess sub-bass energy', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), subBass: -5 } }));
    expect(recs).toContain('Too much sub-bass energy. Apply a high-pass filter below 80Hz.');
  });

  it('names the over-hot band and caps the suggested cut at 10 dB', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), mid: -8 } }));
    expect(recs).toContain('Too much energy in Mid (500Hz-2kHz). Cut 10.0 dB around this range.');
  });

  it('warns about a dull mix lacking brilliance', () => {
    const recs = grading.computeRecommendations(makeSrc({ bands: { ...flatBands(-30), brilliance: -45 } }));
    expect(recs).toContain('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
  });

  it('congratulates a clean recording when nothing is wrong', () => {
    expect(grading.computeRecommendations(makeSrc())).toEqual([
      'Great job! No major issues detected — levels and balance are solid.',
    ]);
  });

  it('never returns more than five recommendations', () => {
    // Pile on every rule at once: clipping, quiet, compressed DR, sub-bass, and
    // multiple imbalanced bands — the raw list exceeds five and is sliced.
    const bands = { ...flatBands(-30), subBass: -5, mid: -8, highMid: -8, presence: -8 };
    const recs = grading.computeRecommendations(
      makeSrc({ clipping: true, rms: -30, peak: -10, dynamicRange: 2, bands }),
    );
    expect(recs.length).toBeLessThanOrEqual(5);
  });
});
