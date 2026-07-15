import { defineConfig } from 'vitest/config';

// Mostly types-only package (#331) plus the install-instructions runtime
// module (#286). src/index.ts now re-exports that module's runtime code, so
// it is measured too (see index.test.ts).
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
      // install-instructions.ts is fully exercised; index.ts's re-exports
      // report 0 instrumentable statements (v8 doesn't count bare `export
      // {...} from` bindings), so 100% is the real, achievable floor.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});