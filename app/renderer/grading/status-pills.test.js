import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { makeSrc } = require('./fixtures.js');

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
