import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { flatBands, makeSrc } = require('./fixtures.js');

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

describe('#135 LUFS / true-peak level rules', () => {
  it('is an A when both LUFS and true peak are measured and healthy', () => {
    expect(grading.computeGrade(makeSrc({ lufsIntegrated: -16, truePeakDbtp: -5 }))).toBe('A');
  });

  it('judges LUFS, not RMS, when LUFS is measured — out-of-band LUFS with in-band RMS drops', () => {
    const src = makeSrc({ rms: -17, lufsIntegrated: -12, truePeakDbtp: -5 });
    expect(grading.computeGrade(src)).toBe('B');
  });

  it('replaces the RMS rule when LUFS is measured — in-band LUFS with out-of-band RMS stays A', () => {
    const src = makeSrc({ rms: -22, lufsIntegrated: -16, truePeakDbtp: -5 });
    expect(grading.computeGrade(src)).toBe('A');
  });

  it('drops one letter when true peak exceeds the ceiling', () => {
    const src = makeSrc({ truePeakDbtp: -0.3, lufsIntegrated: -16 });
    expect(grading.computeGrade(src)).toBe('B');
  });

  it('AC2: a hot sample peak within the true-peak ceiling still grades A', () => {
    const src = makeSrc({ peak: -1.2, truePeakDbtp: -1.05, lufsIntegrated: -16 });
    expect(grading.rcPeakStatus(src.peak, src.clipping)).toBe('check'); // hot per sample-peak heuristic
    expect(grading.computeGrade(src)).toBe('A'); // but true peak governs, not sample peak
  });

  it('stacks the true-peak and LUFS drops', () => {
    const src = makeSrc({ lufsIntegrated: -12, truePeakDbtp: -0.3 });
    expect(grading.computeGrade(src)).toBe('C');
  });

  describe('fallback to RMS when LUFS is not measured', () => {
    it.each([null, undefined, NaN])('falls back to RMS out-of-band drop when lufsIntegrated is %p', (lufsIntegrated) => {
      expect(grading.computeGrade(makeSrc({ lufsIntegrated, rms: -22 }))).toBe('B');
    });
    it.each([null, undefined, NaN])('falls back to RMS in-band pass when lufsIntegrated is %p', (lufsIntegrated) => {
      expect(grading.computeGrade(makeSrc({ lufsIntegrated, rms: -17 }))).toBe('A');
    });
  });

  it('treats -Infinity LUFS as measured — a silent file drops for out-of-band LUFS', () => {
    const src = makeSrc({ lufsIntegrated: -Infinity, truePeakDbtp: -Infinity });
    expect(grading.computeGrade(src)).toBe('B'); // exactly one drop: LUFS out of band, true peak within ceiling
  });

  it('keeps dynamic_service exempt from the LUFS rule too', () => {
    const src = makeSrc({ contentType: 'music', peak: -8, dynamicRange: 20, rms: -30, lufsIntegrated: -30, truePeakDbtp: -5 });
    expect(grading.analyzeRecordingType(src).type).toBe('dynamic_service');
    expect(grading.computeGrade(src)).toBe('A');
  });

  it('applies the true-peak rule on the low_gain path too', () => {
    const src = makeSrc({ peak: -10, rms: -33, dynamicRange: 20, contentType: 'speech', truePeakDbtp: -0.5 });
    expect(grading.analyzeRecordingType(src).type).toBe('low_gain');
    expect(grading.computeGrade(src)).toBe('B');
  });
});
