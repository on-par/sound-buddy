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
      // changed behaviorally. Ratcheted 2026-08-14 (#317): after adding
      // analyze/spectrum.test.ts (the last no-test runtime module — the AI
      // carve-out deleted llm/engineer/display, and #324/#329/#330/#332 covered
      // the rest), the package measures statements 100 / branches 97.77 /
      // functions 100 / lines 100 locally. Floors are measured-minus-margin
      // (2 for statements/lines, 3 for branches/functions, the #401
      // convention) so a regression can't slip through without failing a gate.
      thresholds: { statements: 98, branches: 94, functions: 97, lines: 98 },
    },
  },
});