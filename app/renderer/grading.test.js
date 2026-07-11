import { describe, it, expect } from 'vitest';

// grading is a plain classic script (window.grading / module.exports), the same
// pattern as ideal-curves.js / license-state.js. Require it directly so these
// tests exercise the exact bytes the renderer loads via <script src>. The test
// file is .js (per #130) — Vitest picks it up via the renderer/**/*.test.js glob.
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

describe('explainGrade (#133)', () => {
  // The per-deduction breakdown behind the letter. Its invariant: the deductions
  // returned are exactly the rules computeGrade deducted for — same guards, same
  // order — so these tests double as a cross-check that the two never diverge.

  it('lists exactly the two rules that fired — RMS and DR — and nothing else', () => {
    const src = makeSrc({ rms: -22, dynamicRange: 4 });
    const { grade, clipping, deductions } = grading.explainGrade(src);
    expect(grade).toBe('C'); // two drops from A
    expect(clipping).toBe(false);
    expect(deductions).toEqual([
      { rule: 'RMS out of band', measured: '-22.0 dBFS', target: '-20 to -14 dBFS', letterImpact: 'Drops one letter' },
      { rule: 'Dynamic range too low', measured: '4.0 dB', target: '≥ 6 dB', letterImpact: 'Drops one letter' },
    ]);
  });

  it('states clipping forced an automatic F, with only the clipping deduction', () => {
    // Clipping short-circuits (like computeGrade), so no other rule is evaluated.
    const { grade, clipping, deductions } = grading.explainGrade(
      makeSrc({ clipping: true, rms: -40, dynamicRange: 1 }),
    );
    expect(grade).toBe('F');
    expect(clipping).toBe(true);
    expect(deductions).toEqual([
      { rule: 'Clipping', measured: 'Clipping detected', target: 'No clipping', letterImpact: 'Automatic F' },
    ]);
  });

  it('returns an empty deduction list for a clean recording (the "no deductions" state)', () => {
    const { grade, clipping, deductions } = grading.explainGrade(makeSrc());
    expect(grade).toBe('A');
    expect(clipping).toBe(false);
    expect(deductions).toEqual([]);
  });

  it('reports a band imbalance with the worst offender\'s diff and the severe target', () => {
    const bands = { ...flatBands(-30), mid: -8 }; // mid diff = +22
    const { deductions } = grading.explainGrade(makeSrc({ bands }));
    expect(deductions).toEqual([
      { rule: 'Band imbalance', measured: '+22.0 dB', target: '≤ +15 dB vs. other bands', letterImpact: 'Drops one letter' },
    ]);
  });

  it('exempts RMS on a dynamic service — no RMS deduction despite out-of-band RMS', () => {
    const src = makeSrc({ contentType: 'music', peak: -8, dynamicRange: 20, rms: -30 });
    expect(grading.analyzeRecordingType(src).type).toBe('dynamic_service');
    const { grade, deductions } = grading.explainGrade(src);
    expect(grade).toBe('A');
    expect(deductions).toEqual([]);
  });

  describe('low_gain path (own rule set)', () => {
    it('ignores RMS and shows no deduction for a well-balanced low-gain take', () => {
      const src = makeSrc({ peak: -10, rms: -33, dynamicRange: 20, contentType: 'speech' });
      expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
      const { grade, deductions } = grading.explainGrade(src);
      expect(grade).toBe('A');
      expect(deductions).toEqual([]);
    });

    it('uses the relaxed DR floor (≥ 3 dB) for a compressed low-gain take', () => {
      const src = makeSrc({ peak: -20, rms: -40, dynamicRange: 2 });
      expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
      const { grade, deductions } = grading.explainGrade(src);
      expect(grade).toBe('B');
      expect(deductions).toEqual([
        { rule: 'Dynamic range too low', measured: '2.0 dB', target: '≥ 3 dB', letterImpact: 'Drops one letter' },
      ]);
    });
  });

  it('omits the DR rule entirely when dynamic range is null', () => {
    const { grade, deductions } = grading.explainGrade(makeSrc({ dynamicRange: null }));
    expect(grade).toBe('A');
    expect(deductions).toEqual([]);
  });

  // #136 — the DR rule is skipped for live captures (dynamicRange == null), but
  // that skip must be DISCLOSED, not silent: explainGrade reports it in
  // notMeasured so the card can tell the user the grade used fewer metrics.
  describe('unmeasured-rule disclosure (#136)', () => {
    it('discloses the skipped DR rule when dynamic range is null', () => {
      const { deductions, notMeasured } = grading.explainGrade(makeSrc({ dynamicRange: null }));
      // Still no deduction — the rule did not drop a letter, it simply did not run.
      expect(deductions).toEqual([]);
      expect(notMeasured).toEqual([
        {
          rule: 'Dynamic range',
          measured: 'Not measured',
          note: 'Live capture — dynamic range needs a finished file',
          letterImpact: 'Rule skipped — graded on fewer metrics',
        },
      ]);
    });

    it('reports no skipped rules when dynamic range is measured', () => {
      expect(grading.explainGrade(makeSrc()).notMeasured).toEqual([]);
      expect(grading.explainGrade(makeSrc({ dynamicRange: 4 })).notMeasured).toEqual([]);
    });

    it('discloses the skip on the low-gain path too (own rule set, DR still absent)', () => {
      // A live low-gain take still has no DR; the disclosure must survive the
      // low_gain branch's separate return, not just the normal path. With DR
      // absent, low_gain is reached via the very-low peak/RMS route.
      const src = makeSrc({ peak: -20, rms: -40, dynamicRange: null });
      expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
      expect(grading.explainGrade(src).notMeasured).toEqual([
        {
          rule: 'Dynamic range',
          measured: 'Not measured',
          note: 'Live capture — dynamic range needs a finished file',
          letterImpact: 'Rule skipped — graded on fewer metrics',
        },
      ]);
    });

    it('reports no skipped rules for a clipping source (the forced F ran no other rule)', () => {
      // Clipping forces F for live and file alike, so nothing diverged — claiming
      // "graded on fewer metrics" would misattribute the F. notMeasured stays empty.
      const { grade, notMeasured } = grading.explainGrade(makeSrc({ clipping: true, dynamicRange: null }));
      expect(grade).toBe('F');
      expect(notMeasured).toEqual([]);
    });

    it('grades a live capture and an identical file the same, but only the file is silent', () => {
      // Acceptance criterion: a live (DR null) and file (DR present) source with
      // otherwise identical metrics must not diverge silently. Here the grades
      // match AND the live one discloses the skipped rule — no hidden difference.
      const file = makeSrc({ dynamicRange: 10 });
      const live = makeSrc({ dynamicRange: null });
      expect(grading.computeGrade(live)).toBe(grading.computeGrade(file));
      expect(grading.explainGrade(file).notMeasured).toEqual([]);
      expect(grading.explainGrade(live).notMeasured.length).toBe(1);
    });
  });

  it('is deterministic — same input yields the same ordered list every call', () => {
    const src = makeSrc({ rms: -22, dynamicRange: 4, bands: { ...flatBands(-30), mid: -8 } });
    const a = grading.explainGrade(src);
    const b = grading.explainGrade(src);
    expect(a).toEqual(b);
    // Fixed order: RMS, then DR, then band imbalance.
    expect(a.deductions.map(d => d.rule)).toEqual([
      'RMS out of band', 'Dynamic range too low', 'Band imbalance',
    ]);
  });

  it('agrees with computeGrade across the rule matrix (deduction count vs. letters dropped)', () => {
    const letters = ['A', 'B', 'C', 'D', 'F'];
    const cases = [
      {},
      { rms: -22 },
      { rms: -13 },
      { dynamicRange: 4 },
      { rms: -22, dynamicRange: 4 },
      { bands: { ...flatBands(-30), mid: -8 } },
      { dynamicRange: null },
      { contentType: 'music', peak: -8, dynamicRange: 20, rms: -30 },
      { peak: -20, rms: -40, dynamicRange: 2 },
    ];
    for (const over of cases) {
      const src = makeSrc(over);
      const { grade, deductions } = grading.explainGrade(src);
      expect(grade).toBe(grading.computeGrade(src));
      // Each non-clipping deduction drops exactly one letter from A.
      expect(letters.indexOf(grade)).toBe(deductions.length);
    }
  });

  it('reads targets from CONFIG — moving a threshold moves the reason shown', () => {
    const src = makeSrc({ rms: -15 }); // in the default band → no RMS deduction
    expect(grading.explainGrade(src).deductions).toEqual([]);

    const original = grading.CONFIG.rms.acceptableMax;
    grading.CONFIG.rms.acceptableMax = -16; // now -15 is above the band
    try {
      const { deductions } = grading.explainGrade(src);
      expect(deductions).toEqual([
        { rule: 'RMS out of band', measured: '-15.0 dBFS', target: '-20 to -16 dBFS', letterImpact: 'Drops one letter' },
      ]);
    } finally {
      grading.CONFIG.rms.acceptableMax = original;
    }
    expect(grading.explainGrade(src).deductions).toEqual([]);
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

  describe('rcMetricTarget (#132)', () => {
    it('renders each metric target from its CONFIG threshold', () => {
      // Every string is derived from CONFIG — these expectations mirror the
      // default thresholds asserted in the CONFIG single-source test above.
      expect(grading.rcMetricTarget('peak')).toBe('≤ -3 dBFS'); // CONFIG.peak.checkAbove
      expect(grading.rcMetricTarget('rms')).toBe('-20 to -14 dBFS'); // acceptable band
      expect(grading.rcMetricTarget('dynamicRange')).toBe('≥ 6 dB'); // CONFIG.dynamicRange.good
      expect(grading.rcMetricTarget('centroid')).toBe('500 to 4,000 Hz'); // centroid window
    });

    it('returns null for a metric with no target in CONFIG', () => {
      // Clipping (and any unknown key) has no defined target → the card shows an
      // explicit "—" rather than fabricating a range.
      expect(grading.rcMetricTarget('clipping')).toBeNull();
      expect(grading.rcMetricTarget('nonsense')).toBeNull();
    });

    it('reads targets from CONFIG — moving a threshold moves the displayed target', () => {
      // Single-source proof for the displayed target: change the config value and
      // the target string follows, with no edit to the render code. Restore after.
      const original = grading.CONFIG.rms.acceptableMax;
      grading.CONFIG.rms.acceptableMax = -12;
      try {
        expect(grading.rcMetricTarget('rms')).toBe('-20 to -12 dBFS');
      } finally {
        grading.CONFIG.rms.acceptableMax = original;
      }
      expect(grading.rcMetricTarget('rms')).toBe('-20 to -14 dBFS');
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
