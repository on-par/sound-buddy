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
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', '**/dist/**'],
      // Recalibrated for Vitest 4's more accurate v8 coverage remapping
      // (#224): branches read lower than the old v2 number (~95/84/100/97
      // measured locally post-bump) even though nothing here changed
      // behaviorally.
      thresholds: { statements: 92, branches: 80, functions: 97, lines: 94 },
    },
  },
});