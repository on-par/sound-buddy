import { defineConfig } from 'vitest/config';

// Types-only package (no runtime code, no tests). The type-only source is
// excluded from coverage entirely — there is nothing executable to cover.
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
      // src/index.ts is type-only (#331): interfaces emit no runtime JS, so
      // there is nothing executable to cover. Types are verified by `tsc`.
      exclude: ['src/index.ts', 'src/**/*.test.ts', 'src/**/__tests__/**', '**/dist/**'],
    },
  },
});