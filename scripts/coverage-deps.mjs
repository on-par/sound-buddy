// Best-effort install of the non-workspace roots the unified coverage run
// needs (#338). Failures are reported but never fatal: vitest.config.ts
// skips projects whose install roots are incomplete, so `npm run coverage`
// still writes the widest achievable report (the point of the root run —
// repo scanners score "no report" as zero test posture).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT_INSTALL_ROOTS, isInstalled } from './coverage-install-roots.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// packages/cli's tests resolve @sound-buddy/audio-engine through its
// package.json `main` (./dist/index.js) — a bare `npm ci` installs the
// workspace symlinks but never produces that dist/ output. Unlike app/worker
// above, packages/* are never skipped by vitest.config.ts, so a missing
// build doesn't narrow the report — it makes vitest fail the suite and write
// no coverage report at all (#595, a second instance of #338's failure
// mode). Build the workspaces the same way CI does before running tests.
const build = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
if (build.status !== 0) {
  console.warn(
    'coverage:deps: `npm run build` failed — packages/cli and packages/audio-engine ' +
      'coverage will run against whatever dist/ output already exists, if any.',
  );
}

for (const dir of Object.values(PROJECT_INSTALL_ROOTS).flat()) {
  if (isInstalled(dir)) continue;
  const result = spawnSync('npm', ['ci', '--prefix', dir], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.warn(
      `coverage:deps: npm ci --prefix ${dir} failed — the ${dir} suite will be skipped in the coverage report`,
    );
  }
}
