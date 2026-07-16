// Guard the built Browser Lite page (#314): it must exist, mount the
// analyzer, carry local-only messaging, and never ship an inline <script>
// (the CSP is script-src 'self' — see check-headers.mjs for the same check
// against the whole dist/ tree).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browserPath = fileURLToPath(new URL('../dist/browser/index.html', import.meta.url));

const problems = [];
let html;
try {
  html = await readFile(browserPath, 'utf8');
} catch {
  console.error(`✖ ${browserPath} does not exist.`);
  console.error('  Expected site/src/pages/browser.astro to build to dist/browser/index.html.');
  process.exit(1);
}

if (!html.includes('data-browser-analyzer')) {
  problems.push('Browser page is missing the [data-browser-analyzer] mount point.');
}

const inlineScriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>/i;
if (inlineScriptRe.test(html)) {
  problems.push(
    "dist/browser/index.html contains an inline <script> tag (no src=) — the script-src 'self' " +
      'CSP will block it. Keep vite.build.assetsInlineLimit: 0 in astro.config.mjs so Astro emits ' +
      'the analyzer script as an external file.',
  );
}

if (!/stays in the browser/i.test(html)) {
  problems.push('Browser page must state local-only processing (e.g. "stays in the browser").');
}

if (problems.length) {
  console.error(`✖ ${problems.length} browser-page problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ Browser Lite page builds, mounts the analyzer, has no inline scripts, and states local-only processing.');
