import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 shrank its default test.exclude to just node_modules/.git,
    // dropping the old **/dist/** entry (vitest 2/3 default). Every package
    // here compiles *.test.ts into dist/*.test.js via `tsc`, so without this
    // vitest now double-runs each suite against both the TS source and the
    // stale compiled JS copy — and for ai-analyst the compiled copy's
    // `vi.mock('@anthropic-ai/sdk')` doesn't take, hitting the real API.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', '**/dist/**'],
      // Recalibrated for Vitest 4's more accurate v8 coverage remapping
      // (#224): branches read lower than the old v2 number (100/75/100/100
      // measured locally post-bump) even though nothing here changed
      // behaviorally.
      thresholds: { statements: 98, branches: 70, functions: 98, lines: 98 },
    },
  },
});