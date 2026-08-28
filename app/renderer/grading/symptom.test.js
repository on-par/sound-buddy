import { describe, it, expect } from 'vitest';

const grading = require('../grading.js');
const { flatBands, makeSrc } = require('./fixtures.js');

const muddySymptom = (over = {}) => ({
  ruleId: 'muddy',
  symptom: 'Muddy',
  instruction: 'Highpass below ~100 Hz and cut ~250 Hz',
  excessDb: 8.7,
  minExcessDb: 6,
  ...over,
});

describe('symptomDeduction', () => {
  it('returns null when the source has no symptoms key', () => {
    expect(grading.symptomDeduction(makeSrc())).toBeNull();
  });

  it('returns null for an empty symptoms array', () => {
    expect(grading.symptomDeduction(makeSrc({ symptoms: [] }))).toBeNull();
  });

  it('returns null when the only entry is malformed: null', () => {
    expect(grading.symptomDeduction(makeSrc({ symptoms: [null] }))).toBeNull();
  });

  it('returns null when the only entry is missing symptom', () => {
    const bad = muddySymptom();
    delete bad.symptom;
    expect(grading.symptomDeduction(makeSrc({ symptoms: [bad] }))).toBeNull();
  });

  it('returns null when the only entry has a NaN excessDb', () => {
    expect(grading.symptomDeduction(makeSrc({ symptoms: [muddySymptom({ excessDb: NaN })] }))).toBeNull();
  });

  it('returns null when the only entry is missing minExcessDb', () => {
    const bad = muddySymptom();
    delete bad.minExcessDb;
    expect(grading.symptomDeduction(makeSrc({ symptoms: [bad] }))).toBeNull();
  });

  it('returns a Tonal symptom deduction for one muddy symptom', () => {
    const src = makeSrc({ symptoms: [muddySymptom()] });
    expect(grading.symptomDeduction(src)).toEqual({
      rule: 'Tonal symptom: Muddy',
      measured: '+8.7 dB over reference',
      target: '< +6 dB over reference',
      letterImpact: 'Drops one letter',
    });
  });

  it('names the deduction after the higher-excess symptom and returns only one', () => {
    const src = makeSrc({
      symptoms: [
        muddySymptom({ excessDb: 8.7 }),
        muddySymptom({ ruleId: 'harsh', symptom: 'Quacky/harsh', excessDb: 12, minExcessDb: 6 }),
      ],
    });
    const deduction = grading.symptomDeduction(src);
    expect(deduction.rule).toBe('Tonal symptom: Quacky/harsh');
  });
});

describe('computeGrade with symptoms', () => {
  it('is an A with no symptoms', () => {
    expect(grading.computeGrade(makeSrc())).toBe('A');
  });

  it('drops one letter with one firing symptom', () => {
    expect(grading.computeGrade(makeSrc({ symptoms: [muddySymptom()] }))).toBe('B');
  });

  it('still drops exactly one letter with three co-firing symptoms (curve not retuned)', () => {
    const src = makeSrc({
      symptoms: [
        muddySymptom(),
        muddySymptom({ ruleId: 'harsh', symptom: 'Quacky/harsh' }),
        muddySymptom({ ruleId: 'edgy', symptom: 'Edgy/piezo' }),
      ],
    });
    expect(grading.computeGrade(src)).toBe('B');
  });
});

describe('computeScore with symptoms', () => {
  it('subtracts SYMPTOM_SCORE_PENALTY and lands inside the letter band', () => {
    const src = makeSrc({ symptoms: [muddySymptom()] });
    expect(grading.computeScore(src)).toBe(89);
    expect(grading.computeGrade(src)).toBe('B');
  });
});

describe('explainGrade with symptoms', () => {
  it('includes the symptom deduction, one more than the source without symptoms', () => {
    const plain = grading.explainGrade(makeSrc());
    const withSymptom = grading.explainGrade(makeSrc({ symptoms: [muddySymptom()] }));
    expect(withSymptom.deductions.length).toBe(plain.deductions.length + 1);
    expect(withSymptom.deductions).toContainEqual({
      rule: 'Tonal symptom: Muddy',
      measured: '+8.7 dB over reference',
      target: '< +6 dB over reference',
      letterImpact: 'Drops one letter',
    });
  });

  it('short-circuits to the single Clipping deduction and grade F even with symptoms', () => {
    const src = makeSrc({ clipping: true, symptoms: [muddySymptom()] });
    const result = grading.explainGrade(src);
    expect(result.grade).toBe('F');
    expect(result.deductions).toEqual([{
      rule: 'Clipping',
      measured: 'Clipping detected',
      target: 'No clipping',
      letterImpact: 'Automatic F',
    }]);
  });

  it('takes the symptom deduction on a low_gain source too', () => {
    const src = makeSrc({
      peak: -16, rms: -40, dynamicRange: 20,
      symptoms: [muddySymptom()],
    });
    const result = grading.explainGrade(src);
    expect(result.deductions).toContainEqual(
      expect.objectContaining({ rule: 'Tonal symptom: Muddy' }),
    );
  });
});

describe('computeRecommendations with symptoms', () => {
  it('never emits Great job! beside a named symptom, and names the fix', () => {
    const recs = grading.computeRecommendations(makeSrc({ symptoms: [muddySymptom()] }));
    expect(recs).toContain('Muddy: Highpass below ~100 Hz and cut ~250 Hz');
    expect(recs.some((r) => r.includes('Great job!'))).toBe(false);
  });

  it('still emits Great job! when there are no symptoms', () => {
    const recs = grading.computeRecommendations(makeSrc());
    expect(recs.some((r) => r.includes('Great job!'))).toBe(true);
  });
});
