import { defineConfig } from 'vitest/config';
import { PROJECT_INSTALL_ROOTS, isInstalled } from './scripts/coverage-install-roots.mjs';
import { UI_COVERAGE_EXCLUSIONS } from './app/vitest.config';

// Root Vitest projects config (#237): a single entry point that fans out to
// every suite in the repo (packages/*, app, worker) and merges their coverage
// into one ./coverage report at the root — the artifact repo scanners look
// for when judging test posture. Run it with `npm run coverage`.
//
// app/ and worker/ are not npm workspaces, so a bare clone with only a root
// `npm ci` can't run their suites — and a failed run makes Vitest skip the
// coverage report entirely (#338). Include them only when their deps are
// installed, so any invocation still writes a valid (if narrower) report.
// The install-root map and the "actually installed" check live in
// scripts/coverage-install-roots.mjs, shared with scripts/coverage-deps.mjs
// so the two can't drift.
const optional = Object.keys(PROJECT_INSTALL_ROOTS).filter((dir) =>
  PROJECT_INSTALL_ROOTS[dir].every(isInstalled),
);
const skipped = Object.keys(PROJECT_INSTALL_ROOTS).filter((dir) => !optional.includes(dir));
if (skipped.length > 0) {
  console.warn(
    `[coverage] skipping project(s) ${skipped.join(', ')} — install roots incomplete ` +
      '(run `npm run coverage:deps`); the report covers the remaining projects only.',
  );
}

// This is additive reporting only. The per-workspace `test:coverage` scripts
// and their CI-gated ratchet thresholds (#185/#226) are untouched: in
// projects mode Vitest honors only the root coverage options (per-project
// coverage config is ignored by design), and no thresholds are set here —
// the gate stays where it is.
export default defineConfig({
  test: {
    projects: ['packages/*', ...optional],
    // Exclude Playwright e2e specs — they're driven by `npm run test:e2e`, not vitest.
    // Without this, vitest in projects mode picks up app/tests/e2e/*.spec.ts and crashes
    // on Playwright's test.describe(), preventing the coverage report from being written.
    exclude: ['**/tests/e2e/**', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'json-summary', 'cobertura'],
      // Mirror each project's coverage.include, re-rooted at the repo root —
      // include patterns here resolve against the root, not each project.
      // Everything vendored/generated under app/ (.build-cache, release,
      // dist, assets) is excluded by omission, same as app's own config.
      // Skipped projects drop out of include too — otherwise their untested
      // sources would count as 0% and distort the merged totals.
      include: [
        'packages/*/src/**/*.ts',
        ...(optional.includes('app')
          ? ['app/electron/**/*.ts', 'app/renderer/**/*.{ts,tsx,js}']
          : []),
        ...(optional.includes('worker') ? ['worker/src/**/*.ts'] : []),
      ],
      exclude: [
        '**/*.test.{ts,js}',
        '**/dist/**',
        '**/*.config.{ts,js,mjs}',
        'worker/src/e2e/**',
        // Shared with app/vitest.config.ts's UI_COVERAGE_EXCLUSIONS (#401) —
        // e2e-verified DOM glue (#303) and the shared test double (#308)
        // don't count toward coverage there, so they must not count here
        // either. Imported, not duplicated, so the two lists can't drift.
        ...UI_COVERAGE_EXCLUSIONS.map((e) => `app/${e.path}`),
      ],
    },
  },
});
