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

describe('CONFIG — single source of truth (#131)', () => {
  it('exposes every threshold group the grade and pills read from', () => {
    expect(grading.CONFIG).toMatchObject({
      rms: { acceptableMin: -20, acceptableMax: -14, quietEdge: -25, hotEdge: -10 },
      peak: { issueAbove: -1, checkAbove: -3 },
      dynamicRange: { good: 6, check: 3 },
      bandBalance: { hotDiff: 12, severeHotDiff: 15, quietDiff: -15 },
      centroid: { min: 500, max: 4000 },
    });
  });
});

describe('status pills', () => {
  describe('rcRmsStatus', () => {
    it('calls the whole grade-acceptable band "good"', () => {
      // The reconciliation (#131): the acceptable band [-20, -14] is uniformly
      // "good" — no more narrow -18..-16 window that contradicted the grade.
      for (const rms of [-20, -18, -17, -16, -14]) {
        expect(grading.rcRmsStatus(rms)).toBe('good');
      }
    });
    it('calls any out-of-band level "issue", mirroring the grade\'s RMS deduction', () => {
      // The pill tracks the grade's single in-band/out-of-band test, so every
      // level the grade deducts for reads "issue" — matching the pre-#131
      // out-of-band behaviour (nothing is silently downgraded to a milder pill).
      for (const rms of [-30, -25, -22, -21, -13, -11, -10, -5]) {
        expect(grading.rcRmsStatus(rms)).toBe('issue');
      }
    });
  });

  describe('rcPeakStatus', () => {
    it('classifies peaks and always flags clipping', () => {
      expect(grading.rcPeakStatus(-6, false)).toBe('good');
      expect(grading.rcPeakStatus(-2, false)).toBe('check');
      expect(grading.rcPeakStatus(-0.5, false)).toBe('issue');
      expect(grading.rcPeakStatus(-6, true)).toBe('issue');
    });
  });

  describe('rcDrStatus', () => {
    it('classifies dynamic range and treats missing DR as "check"', () => {
      expect(grading.rcDrStatus(null)).toBe('check');
      expect(grading.rcDrStatus(8)).toBe('good');
      expect(grading.rcDrStatus(4)).toBe('check');
      expect(grading.rcDrStatus(2)).toBe('issue');
    });
  });

  describe('rcCentroidStatus', () => {
    it('classifies the centroid window and treats a falsy centroid as "check"', () => {
      expect(grading.rcCentroidStatus(0)).toBe('check');
      expect(grading.rcCentroidStatus(2000)).toBe('good');
      expect(grading.rcCentroidStatus(200)).toBe('check');
      expect(grading.rcCentroidStatus(6000)).toBe('check');
    });
  });

  describe('grade / pill direction agreement (#131)', () => {
    // The contradiction #131 fixes: a "good" RMS pill must never coincide with
    // an RMS-driven grade deduction, and vice versa. Sweep the RMS axis holding
    // everything else clean and assert the two never point opposite directions.
    it('never shows a "good" RMS pill while the grade deducts for RMS, or vice versa', () => {
      for (let rms = -32; rms <= -4; rms += 0.5) {
        const src = makeSrc({ rms });
        const pill = grading.rcRmsStatus(rms);
        // On an otherwise-clean source the only possible deduction is RMS, so an
        // A means "no RMS deduction" and anything below A means "RMS deducted".
        const rmsDeducted = grading.computeGrade(src) !== 'A';
        if (pill === 'good') expect(rmsDeducted).toBe(false);
        if (rmsDeducted) expect(pill).not.toBe('good');
      }
    });
  });

  describe('single-source consumption (#131)', () => {
    // Proves the grade AND the pill both read the same CONFIG value: move the
    // acceptable-band ceiling and watch a formerly-passing level fall out of
    // band for BOTH. Restore CONFIG afterwards so other tests are unaffected.
    it('moving a threshold shifts both the grade and the matching pill', () => {
      const rms = -15; // in the default band → grade A, pill "good"
      expect(grading.computeGrade(makeSrc({ rms }))).toBe('A');
      expect(grading.rcRmsStatus(rms)).toBe('good');

      const original = grading.CONFIG.rms.acceptableMax;
      grading.CONFIG.rms.acceptableMax = -16; // now -15 is above the band
      try {
        expect(grading.computeGrade(makeSrc({ rms }))).toBe('B'); // grade drops
        expect(grading.rcRmsStatus(rms)).toBe('issue'); // pill follows
      } finally {
        grading.CONFIG.rms.acceptableMax = original;
      }
      // Restored: back to the passing state.
      expect(grading.computeGrade(makeSrc({ rms }))).toBe('A');
      expect(grading.rcRmsStatus(rms)).toBe('good');
    });
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
