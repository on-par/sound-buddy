// Prove PUBLIC_SITE_MODE=live renders the pre-waitlist-epic homepage exactly
// (#602) — the reversibility guarantee of the PUBLIC_SITE_MODE toggle
// (#597): flipping back to live must restore today's pricing/download page
// unchanged. Builds the site in live mode under a sanitized env (every
// PUBLIC_* var stripped except PUBLIC_SITE_MODE — see live-parity.mjs for
// why this makes the build deterministic), then compares the built
// index.html byte-for-byte against a committed golden copy and independently
// asserts no waitlist markers leaked in and the live structure is intact.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  compareLiveHomeToGolden,
  checkLiveHomeLeakMarkers,
  checkLiveHomeStructure,
} from './lib/live-parity.mjs';

const siteRoot = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = 'dist-live-parity';
const outDirAbs = fileURLToPath(new URL(`../${OUT_DIR}/`, import.meta.url));
const goldenPath = fileURLToPath(new URL('./live-home.golden.html', import.meta.url));
const shouldUpdate = process.argv.includes('--update');

// Astro's own env plugin reloads `.env*` files from disk on every build and
// overwrites process.env with whatever it finds there (astro/dist/env/vite-
// plugin-env.js's buildStart hook) — so merely deleting a PUBLIC_* key here
// isn't enough to keep it deterministic if a developer has a site/.env.local
// with (e.g.) a real PUBLIC_FOUNDING_CHECKOUT_URL. Vite's loadEnv resolves
// process.env last, so explicitly setting each var below (rather than
// deleting it) wins over whatever `.env.local` defines (#602).
const KNOWN_PUBLIC_ENV_VARS = ['PUBLIC_FOUNDING_CHECKOUT_URL', 'PUBLIC_DEMO_VIDEO_URL'];

function sanitizedLiveEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PUBLIC_')) delete env[key];
  }
  for (const key of KNOWN_PUBLIC_ENV_VARS) {
    env[key] = '';
  }
  env.PUBLIC_SITE_MODE = 'live';
  return env;
}

await rm(outDirAbs, { recursive: true, force: true });

const result = spawnSync('npx', ['astro', 'build', '--outDir', OUT_DIR], {
  env: sanitizedLiveEnv(),
  stdio: 'inherit',
  cwd: siteRoot,
});
if (result.status !== 0) {
  console.error(
    '✖ astro build failed in live mode — run `PUBLIC_SITE_MODE=live npx astro build` in site/ to reproduce',
  );
  process.exit(1);
}

let builtHtml;
try {
  builtHtml = await readFile(`${outDirAbs}index.html`, 'utf8');
} catch (err) {
  console.error(
    `✖ Could not read ${outDirAbs}index.html after a successful astro build (${err.message}) — run \`PUBLIC_SITE_MODE=live npx astro build --outDir ${OUT_DIR}\` in site/ to reproduce (#602).`,
  );
  process.exit(1);
}

if (shouldUpdate) {
  const problems = [...checkLiveHomeLeakMarkers(builtHtml), ...checkLiveHomeStructure(builtHtml)];
  if (problems.length) {
    console.error(`✖ Refusing to write the golden — the fresh build fails ${problems.length} invariant(s):`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  await writeFile(goldenPath, builtHtml, 'utf8');
  console.log(`✓ wrote ${goldenPath} (#602) — review the diff and commit it`);
  process.exit(0);
}

let goldenHtml;
try {
  goldenHtml = await readFile(goldenPath, 'utf8');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(
      `✖ No golden found at ${goldenPath} — run \`node scripts/check-live-parity.mjs --update\` once and commit the file (#602).`,
    );
  } else {
    console.error(`✖ Could not read the golden at ${goldenPath}: ${err.message} (#602).`);
  }
  process.exit(1);
}

const problems = [
  ...compareLiveHomeToGolden(builtHtml, goldenHtml),
  ...checkLiveHomeLeakMarkers(builtHtml),
  ...checkLiveHomeStructure(builtHtml),
  ...checkLiveHomeLeakMarkers(goldenHtml),
  ...checkLiveHomeStructure(goldenHtml),
];

if (problems.length) {
  console.error(`✖ ${problems.length} live-parity invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ live-mode homepage matches the golden byte-for-byte (#602)');
