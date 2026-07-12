import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Root Vitest projects config (#237): a single entry point that fans out to
// every suite in the repo (packages/*, app, worker) and merges their coverage
// into one ./coverage report at the root — the artifact repo scanners look
// for when judging test posture. Run it with `npm run coverage`.
//
// app/ and worker/ are not npm workspaces, so a bare clone with only a root
// `npm ci` can't run their suites — and a failed run makes Vitest skip the
// coverage report entirely (#338). Include them only when their deps are
// installed, so any invocation still writes a valid (if narrower) report.
// app has two install roots: its own devDeps plus renderer/ (react et al.,
// imported by the renderer unit tests since #304).
const projectDeps: Record<string, string[]> = {
  app: ['app/node_modules', 'app/renderer/node_modules'],
  worker: ['worker/node_modules'],
};
const optional = Object.keys(projectDeps).filter((dir) =>
  projectDeps[dir].every((dep) => existsSync(new URL(`./${dep}`, import.meta.url))),
);

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
      reporter: ['text', 'lcov', 'json-summary'],
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
        '**/__tests__/**',
        '**/dist/**',
        '**/*.config.{ts,js,mjs}',
        // Mirror app's own coverage excludes (see app/vitest.config.ts for
        // the rationale): e2e-verified DOM glue (#303) and the shared test
        // double (#308) don't count toward coverage there, so they must not
        // count here either.
        'app/renderer/src/main.tsx',
        'app/renderer/src/App.tsx',
        'app/renderer/src/inline-app.js',
        'app/renderer/src/mock-sound-buddy.ts',
      ],
    },
  },
});
