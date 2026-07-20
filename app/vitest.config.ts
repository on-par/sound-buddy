import { defineConfig } from 'vitest/config';

// Unit tests are colocated with the code they cover: main-process logic under
// electron/, pure renderer helpers under renderer/. The Playwright e2e specs
// under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
// Renderer tests are .test.ts by convention; the grading.js suite (#130,
// split into renderer/grading/*.test.js per #225) is .js, so the renderer
// glob covers both extensions and recurses into subdirectories.
// Coverage exclusions for renderer modules with no meaningful unit-test
// surface. Each entry MUST name the e2e spec (or colocated test) that
// actually exercises it — an exclusion with no other gate is a coverage
// hole, not a coverage decision. Guarded by vitest.config.test.ts (#401).
export const UI_COVERAGE_EXCLUSIONS = [
  {
    path: 'renderer/src/main.tsx',
    reason: 'React mount glue (#303) — 11 LOC of createRoot wiring, no branches.',
    gate: 'tests/e2e/report-card-basics.spec.ts',
  },
  {
    path: 'renderer/src/App.tsx',
    reason: 'React shell + BOOT_SCRIPTS injection (#303) — DOM glue, e2e-verified.',
    gate: 'tests/e2e/report-card-basics.spec.ts',
  },
  {
    path: 'renderer/src/inline-app.js',
    reason:
      'Imperative runtime owner being drained by the TD-001 slices; scheduled for ' +
      'deletion in #424, at which point this entry goes away rather than being ' +
      'instrumented. Behavior is gated by the Playwright e2e suite meanwhile.',
    gate: 'tests/e2e/live-capture-workspace.spec.ts',
  },
  {
    path: 'renderer/src/mock-sound-buddy.ts',
    reason:
      'Test double (#308) — ~50 default stubs most tests never invoke; counting ' +
      'them as uncovered functions penalizes test infrastructure.',
    gate: 'renderer/src/mock-sound-buddy.test.ts',
  },
] as const;

export default defineConfig({
  test: {
    // Unit tests are colocated with the code they cover: main-process logic under
    // electron/, pure renderer helpers under renderer/. The Playwright e2e specs
    // under tests/ are driven by `npm run test:e2e`, not Vitest — keep them out.
    // Renderer tests are .test.ts by convention; the grading.js suite (#130,
    // split into renderer/grading/*.test.js per #225) is .js, so the renderer
    // glob covers both extensions and recurses into subdirectories. '*.test.ts'
    // additionally picks up colocated config guard tests at the package root
    // (e.g. vitest.config.test.ts, #401).
    include: ['*.test.ts', 'electron/**/*.test.ts', 'renderer/**/*.test.{ts,js}'],
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
      include: ['electron/**/*.ts', 'renderer/**/*.{ts,tsx,js}'],
      exclude: [
        'electron/**/*.test.ts',
        'renderer/**/*.test.{ts,js}',
        '*.test.ts',
        '**/*.config.{ts,js,mjs}',
        '**/dist/**',
        'build/**',
        '.build-cache/**',
        'release/**',
        'assets/**',
        'coverage/**',
        'test-results/**',
        ...UI_COVERAGE_EXCLUSIONS.map((e) => e.path),
      ],
      // Ratcheted 2026-07-20 (#401): measured locally at statements 96.31 /
      // branches 91.33 / functions 94.98 / lines 97.01 under Vitest 4's v8
      // coverage remapping. Floors are Math.floor(measured) - MARGIN, with
      // MARGIN 2 for statements/lines (stable across platforms) and MARGIN 3
      // for branches/functions (these drift most between macOS and the
      // Ubuntu CI runner — see packages/cli's 91.7% local / 84.6% CI split).
      // Next ratchet step is #424, which deletes inline-app.js outright.
      thresholds: { statements: 94, branches: 88, functions: 91, lines: 95 },
    },
  },
});
