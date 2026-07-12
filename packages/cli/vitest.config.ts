import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 shrank its default test.exclude to just node_modules/.git,
    // dropping the old **/dist/** entry (vitest 2/3 default). This package
    // compiles *.test.ts into dist/*.test.js via `tsc`, so without this
    // vitest would double-run every suite against both the TS source and
    // the stale compiled JS copy.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', '**/dist/**'],
      // functions floor is CI-calibrated: CI measures lower than macOS (a
      // couple functions only run on darwin) — keep it below CI reality so
      // it's a ratchet, not a constant false alarm. Also recalibrated for
      // Vitest 4's more accurate v8 coverage remapping (#224): branches and
      // functions read lower than the old v2 numbers (~75/65/75/77 measured
      // locally post-bump) even though nothing here changed behaviorally.
      thresholds: { statements: 70, branches: 60, functions: 68, lines: 72 },
    },
  },
});