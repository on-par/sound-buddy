import { defineConfig } from 'vitest/config';

// Unit tests are colocated with the code they cover: main-process logic under
// electron/, pure renderer helpers under renderer/. The Playwright e2e specs
// under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
// Renderer tests are .test.ts by convention; the grading.js suite (#130,
// split into renderer/grading/*.test.js per #225) is .js, so the renderer
// glob covers both extensions and recurses into subdirectories.
export default defineConfig({
  test: {
    // Unit tests are colocated with the code they cover: main-process logic under
    // electron/, pure renderer helpers under renderer/. The Playwright e2e specs
    // under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
    // Renderer tests are .test.ts by convention; the grading.js suite (#130,
    // split into renderer/grading/*.test.js per #225) is .js, so the renderer
    // glob covers both extensions and recurses into subdirectories.
    include: ['electron/**/*.test.ts', 'renderer/**/*.test.{ts,js}'],
    coverage: {
      provider: 'v8',
      // Only instrument real source. Everything else under app/ — the Python
      // runtime + emscripten bundles under .build-cache/ and release/,
      // dist/, build scripts, configs, assets — is vendored/generated and
      // must NOT count toward coverage. (No separate "app/**" exclude entry
      // is needed: `include` above already restricts instrumentation to
      // electron/ and renderer/, so anything else is excluded by omission —
      // and under vitest 4's coverage-v8 an "app/**" pattern matches every
      // path here, since this package's own directory is named app/, which
      // zeroed out all coverage. See #224.)
      include: ['electron/**/*.ts', 'renderer/**/*.{ts,js}'],
      exclude: [
        'electron/**/*.test.ts',
        'renderer/**/*.test.{ts,js}',
        '**/*.config.{ts,js,mjs}',
        '**/dist/**',
        'build/**',
        '.build-cache/**',
        'release/**',
        'assets/**',
        'coverage/**',
        'test-results/**',
        // React mount + verbatim-ported boot scripts (#303) — DOM/UI glue
        // with no unit-test surface (same reason index.html was never
        // instrumented before this existed); verified by the Playwright
        // e2e/smoke suite instead, not Vitest coverage.
        'renderer/src/**',
      ],
      // Recalibrated for Vitest 4's more accurate v8 coverage remapping
      // (#224): branches/functions in particular read lower than the old v2
      // numbers (~57/62/51/57 measured locally post-bump, plus the app/**
      // exclude bug fixed above) even though nothing here changed
      // behaviorally.
      thresholds: { statements: 52, branches: 55, functions: 45, lines: 52 },
    },
  },
});
