// Best-effort install of the non-workspace roots the unified coverage run
// needs (#338). Failures are reported but never fatal: vitest.config.ts
// skips projects whose install roots are incomplete, so `npm run coverage`
// still writes the widest achievable report (the point of the root run —
// repo scanners score "no report" as zero test posture).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT_INSTALL_ROOTS, isInstalled } from './coverage-install-roots.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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
