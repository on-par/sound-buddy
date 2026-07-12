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
      // `scripts/` holds dev/benchmark tooling, not shipped library code.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'scripts/**',
        '**/dist/**',
      ],
      // Vitest 4's v8 provider does more accurate AST-aware coverage
      // remapping (#224) — branches/functions in particular came out lower
      // than the old (less precise) v2 numbers even though nothing here
      // changed behaviorally. Floors are recalibrated a few points below the
      // new measured baseline (~31/32/36/32), same ratchet-not-alarm intent
      // as before.
      thresholds: { statements: 28, branches: 28, functions: 32, lines: 28 },
    },
  },
});