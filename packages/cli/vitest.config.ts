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
      // Ratcheted 2026-08-14 (#317): after #317's error-path and JSON-branch
      // additions to analyze.test.ts, the package measures statements 100 /
      // branches 98.75 / functions 100 / lines 100 locally. The old note about
      // darwin-only functions is obsolete — cli/src has no platform-specific
      // code anymore (verified by grep). Floors are measured-minus-margin
      // (2 for statements/lines, 3 for branches/functions, the #401
      // convention) so a regression can't slip through without failing a gate.
      thresholds: { statements: 98, branches: 95, functions: 97, lines: 98 },
    },
  },
});