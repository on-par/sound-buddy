import { describe, it, expect } from 'vitest';

// grading is a plain classic script (window.grading / module.exports), the same
// pattern as ideal-curves.js / license-state.js. Require it directly so these
// tests exercise the exact bytes the renderer loads via <script src>. The test
// file is .js (per #130) — Vitest picks it up via the renderer/**/*.test.js glob.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const grading = require('./grading.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixtures = require('./grading.golden.json');

/*
 * #137 determinism guard: source-object JSON fixtures are paired with committed
 * expected grade / score / top-fix outputs. A threshold change should surface as
 * a per-fixture expected-vs-received diff; regenerate the JSON deliberately when
 * grading behaviour is intentionally changed. The fixtures are pure source
 * objects, so this suite needs no DOM, IPC, sox, ffmpeg, Python, or media decode.
 */

describe('grading golden fixtures (#137)', () => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it('matches the committed golden output', () => {
        expect(grading.computeGrade(fixture.source)).toBe(fixture.expected.grade);
        expect(grading.computeScore(fixture.source)).toBe(fixture.expected.score);
        expect(grading.computeRecommendations(fixture.source)).toEqual(fixture.expected.recommendations);

        const ex = grading.explainGrade(fixture.source);
        expect(ex.grade).toBe(fixture.expected.grade);
        expect(ex.deductions).toEqual(fixture.expected.deductions);
        expect(ex.notMeasured).toEqual(fixture.expected.notMeasured);
        expect(ex.grade).toBe(grading.computeGrade(fixture.source));
      });
    });
  }

  it('covers the required representative scenarios', () => {
    const cases = new Set(fixtures.map(f => f.case));
    for (const requiredCase of [
      'clean_pass_a',
      'clipping_f',
      'rms_out_of_band_drop',
      'dynamic_range_too_low_drop',
      'band_imbalance_drop',
      'low_gain_path',
      'dynamic_range_null_live',
    ]) {
      expect(cases.has(requiredCase)).toBe(true);
    }
  });
});
