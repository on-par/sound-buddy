import { defineConfig } from 'vitest/config';

// Root Vitest projects config (#237): a single entry point that fans out to
// every suite in the repo (packages/*, app, worker) and merges their coverage
// into one ./coverage report at the root — the artifact repo scanners look
// for when judging test posture. Run it with `npm run coverage`.
//
// This is additive reporting only. The per-workspace `test:coverage` scripts
// and their CI-gated ratchet thresholds (#185/#226) are untouched: in
// projects mode Vitest honors only the root coverage options (per-project
// coverage config is ignored by design), and no thresholds are set here —
// the gate stays where it is.
export default defineConfig({
  test: {
    projects: ['packages/*', 'app', 'worker'],
    // Exclude Playwright e2e specs — they're driven by `npm run test:e2e`, not vitest.
    // Without this, vitest in projects mode picks up app/tests/e2e/*.spec.ts and crashes
    // on Playwright's test.describe(), preventing the coverage report from being written.
    exclude: ['**/tests/e2e/**', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'json-summary'],
      // Mirror each project's coverage.include, re-rooted at the repo root —
      // include patterns here resolve against the root, not each project.
      // Everything vendored/generated under app/ (.build-cache, release,
      // dist, assets) is excluded by omission, same as app's own config.
      include: [
        'packages/*/src/**/*.ts',
        'app/electron/**/*.ts',
        'app/renderer/**/*.{ts,js}',
        'worker/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.{ts,js}',
        '**/__tests__/**',
        '**/dist/**',
        '**/*.config.{ts,js,mjs}',
      ],
    },
  },
});
