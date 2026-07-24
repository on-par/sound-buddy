// Build the site in both PUBLIC_SITE_MODE variants deterministically — CI's
// main build is live-only (ci.yml sets PUBLIC_SITE_MODE: live), so nothing
// else in the pipeline proves the waitlist-mode build works or that the two
// modes' nav trim matches the #601 acceptance criteria. Asserts:
//   - the legal pages (/terms, /privacy, /refund) build and stay reachable,
//     with their footer cross-linking all three policies, in BOTH modes
//   - the waitlist homepage has no Download/Pricing/#pricing links but keeps
//     Terms + Privacy
//   - the live homepage keeps Download, Pricing, and the legal links
//   - /browser stays reachable in waitlist mode (epic OQ1: reachable-but-
//     unlinked). /download is a Worker route (wrangler.jsonc run_worker_first)
//     with no PUBLIC_SITE_MODE reference in worker/, so it needs no static
//     build assertion here.
import { spawnSync } from 'node:child_process';
import { readFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LEGAL_PAGE_PATHS,
  checkWaitlistHomeInvariants,
  checkLiveHomeInvariants,
  checkLegalPageInvariants,
} from './lib/site-mode-invariants.mjs';

const siteRoot = fileURLToPath(new URL('..', import.meta.url));
const MODES = [
  ['waitlist', 'dist-waitlist'],
  ['live', 'dist-live'],
];

const problems = [];

for (const [mode, outDir] of MODES) {
  const outDirAbs = fileURLToPath(new URL(`../${outDir}/`, import.meta.url));
  await rm(outDirAbs, { recursive: true, force: true });

  const result = spawnSync('npx', ['astro', 'build', '--outDir', outDir], {
    env: { ...process.env, PUBLIC_SITE_MODE: mode },
    stdio: 'inherit',
    cwd: siteRoot,
  });
  if (result.status !== 0) {
    console.error(
      `✖ astro build failed in ${mode} mode — run \`PUBLIC_SITE_MODE=${mode} npx astro build\` in site/ to reproduce`,
    );
    process.exit(1);
  }

  for (const path of LEGAL_PAGE_PATHS) {
    const filePath = `${outDirAbs}${path}/index.html`;
    try {
      await access(filePath);
    } catch {
      problems.push(`[${mode}] ${path} did not build in ${mode} mode — legal pages must stay reachable in both modes (#601).`);
      continue;
    }
    const html = await readFile(filePath, 'utf8');
    problems.push(...checkLegalPageInvariants(html, path).map((p) => `[${mode}] ${p}`));
  }

  let indexHtml;
  try {
    indexHtml = await readFile(`${outDirAbs}index.html`, 'utf8');
  } catch {
    problems.push(`[${mode}] index.html did not build in ${mode} mode — cannot verify homepage nav trim (#601).`);
    continue;
  }
  const homeProblems = mode === 'waitlist' ? checkWaitlistHomeInvariants(indexHtml) : checkLiveHomeInvariants(indexHtml);
  problems.push(...homeProblems.map((p) => `[${mode}] ${p}`));

  if (mode === 'waitlist') {
    try {
      await access(`${outDirAbs}browser/index.html`);
    } catch {
      problems.push('[waitlist] /browser did not build in waitlist mode — it must stay reachable-but-unlinked (epic OQ1, #601).');
    }
  }
}

if (problems.length) {
  console.error(`✖ ${problems.length} site-mode invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ site-mode invariants hold (waitlist + live)');
