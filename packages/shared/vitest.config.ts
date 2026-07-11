import { defineConfig } from 'vitest/config';

// Types-only package (no runtime code, no tests). Coverage is reported for
// completeness but has no threshold — there is nothing executable to cover.
export default defineConfig({
  test: {
    // Vitest 4 shrank its default test.exclude to just node_modules/.git,
    // dropping the old **/dist/** entry (vitest 2/3 default). This package
    // compiles to dist/ via `tsc`, so without this vitest would pick up any
    // compiled *.test.js copies alongside the TS sources.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', '**/dist/**'],
    },
  },
});