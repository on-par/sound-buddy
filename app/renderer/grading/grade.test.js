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
