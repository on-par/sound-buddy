import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { flatBands, makeSrc } = require('./fixtures.js');

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

  describe('#135 LUFS / true-peak deductions', () => {
    it('pushes an "Integrated loudness out of band" deduction when LUFS is measured and out of band', () => {
      const src = makeSrc({ rms: -17, lufsIntegrated: -12, truePeakDbtp: -5 });
      const { grade, deductions } = grading.explainGrade(src);
      expect(grade).toBe('B');
      expect(deductions).toEqual([
        { rule: 'Integrated loudness out of band', measured: '-12.0 LUFS', target: '-20 to -14 LUFS', letterImpact: 'Drops one letter' },
      ]);
    });

    it('pushes a "True peak over ceiling" deduction when true peak exceeds the ceiling', () => {
      const src = makeSrc({ rms: -17, lufsIntegrated: -16, truePeakDbtp: -0.3 });
      const { grade, deductions } = grading.explainGrade(src);
      expect(grade).toBe('B');
      expect(deductions).toEqual([
        { rule: 'True peak over ceiling', measured: '-0.3 dBTP', target: '≤ -1 dBTP', letterImpact: 'Drops one letter' },
      ]);
    });

    it('orders the true-peak deduction before the LUFS deduction when both fire', () => {
      const src = makeSrc({ lufsIntegrated: -12, truePeakDbtp: -0.3 });
      const { grade, deductions } = grading.explainGrade(src);
      expect(grade).toBe(grading.computeGrade(src));
      expect(deductions.map((d) => d.rule)).toEqual([
        'True peak over ceiling', 'Integrated loudness out of band',
      ]);
    });

    it('falls back to the RMS deduction when LUFS is not measured', () => {
      const src = makeSrc({ rms: -22, lufsIntegrated: null });
      const { deductions } = grading.explainGrade(src);
      expect(deductions).toEqual([
        { rule: 'RMS out of band', measured: '-22.0 dBFS', target: '-20 to -14 dBFS', letterImpact: 'Drops one letter' },
      ]);
    });

    it('omits the RMS deduction when LUFS is measured, even if RMS is out of band', () => {
      const src = makeSrc({ rms: -22, lufsIntegrated: -16, truePeakDbtp: -5 });
      const { deductions } = grading.explainGrade(src);
      expect(deductions).toEqual([]);
    });

    it('formats a silent recording\'s out-of-band LUFS deduction as "-∞ LUFS", matching the app\'s infinity convention (review fix)', () => {
      // -Infinity is a legitimate, measured LUFS value (ffmpeg's "-inf" for a
      // fully silent file, #134) — raw toFixed(1) renders it as the literal
      // string "-Infinity", breaking the "-∞" convention report-card.ts's
      // fmt() uses for the same value elsewhere on the same card.
      const src = makeSrc({ lufsIntegrated: -Infinity, truePeakDbtp: -5 });
      const { deductions } = grading.explainGrade(src);
      expect(deductions).toEqual([
        { rule: 'Integrated loudness out of band', measured: '-∞ LUFS', target: '-20 to -14 LUFS', letterImpact: 'Drops one letter' },
      ]);
    });
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
