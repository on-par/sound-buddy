import { describe, it, expect } from 'vitest';

// grading is a plain classic script (window.grading / module.exports), the same
// pattern as ideal-curves.js / license-state.js. Require it directly so these
// tests exercise the exact bytes the renderer loads via <script src>. The test
// file is .js (per #130) — Vitest picks it up via the renderer/**/*.test.js glob.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const grading = require('./grading.js');

// Seven-band table, all equal → every band's diff-from-others is 0. Overriding
// one band is how we inject an imbalance without disturbing the others' verdict.
const flatBands = (db = -30) => ({
  subBass: db, bass: db, lowMid: db, mid: db, highMid: db, presence: db, brilliance: db,
});

// A clean, healthy source: not clipping, RMS in band, DR comfortable, balanced.
// Individual tests override only the field under test (behaviour is a pure
// function of these fields, so nothing else can leak in).
const makeSrc = (over = {}) => ({
  rms: -17,
  peak: -6,
  dynamicRange: 10,
  clipping: false,
  centroid: 2000,
  contentType: null,
  bands: flatBands(),
  ...over,
});

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

describe('computeGrade', () => {
  it('is an A for a clean, balanced, in-band recording', () => {
    expect(grading.computeGrade(makeSrc())).toBe('A');
  });

  it('is an F whenever clipping is present, regardless of everything else', () => {
    expect(grading.computeGrade(makeSrc({ clipping: true }))).toBe('F');
  });

  it('drops exactly one letter for an out-of-band RMS', () => {
    expect(grading.computeGrade(makeSrc({ rms: -22 }))).toBe('B'); // rms < -20
    expect(grading.computeGrade(makeSrc({ rms: -13 }))).toBe('B'); // rms > -14
  });

  it('drops exactly one letter for compressed dynamic range (< 6)', () => {
    expect(grading.computeGrade(makeSrc({ dynamicRange: 4 }))).toBe('B');
  });

  it('drops exactly one letter for a band imbalance (> 15 dB)', () => {
    const bands = { ...flatBands(-30), mid: -8 }; // mid diff = +22
    expect(grading.computeGrade(makeSrc({ bands }))).toBe('B');
  });

  it('stacks drops — RMS and DR violations together drop two letters', () => {
    expect(grading.computeGrade(makeSrc({ rms: -22, dynamicRange: 4 }))).toBe('C');
  });

  it('skips the dynamic-range rules entirely when DR is null', () => {
    expect(grading.computeGrade(makeSrc({ dynamicRange: null }))).toBe('A');
  });

  it('exempts RMS on a dynamic service even when whole-file RMS is out of band', () => {
    const src = makeSrc({ contentType: 'music', peak: -8, dynamicRange: 20, rms: -30 });
    expect(grading.analyzeRecordingType(src).type).toBe('dynamic_service');
    expect(grading.computeGrade(src)).toBe('A'); // rms -30 would otherwise drop it
  });

  describe('low_gain path', () => {
    it('grades a well-balanced low-gain take an A (own rule set, RMS ignored)', () => {
      const src = makeSrc({ peak: -10, rms: -33, dynamicRange: 20, contentType: 'speech' });
      expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
      expect(grading.computeGrade(src)).toBe('A');
    });

    it('drops a low-gain take for a compressed DR (< 3)', () => {
      const src = makeSrc({ peak: -20, rms: -40, dynamicRange: 2 });
      expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
      expect(grading.computeGrade(src)).toBe('B');
    });

    it('drops a low-gain take for a band imbalance', () => {
      const bands = { ...flatBands(-30), mid: -8 };
      const src = makeSrc({ peak: -20, rms: -40, dynamicRange: 10, bands });
      expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
      expect(grading.computeGrade(src)).toBe('B');
    });
  });
});

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
