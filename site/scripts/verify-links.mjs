// Smoke-check the built site: walk dist/, assert the single page exists,
// and verify every internal <a href> resolves to a real file or in-page anchor.
// External links are out of scope (would need network + flake handling).
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));

/** Recursively collect files under dir. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** Extract hrefs from anchor tags in an HTML string. */
function hrefs(html) {
  const out = [];
  const re = /<a\b[^>]*\shref="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const files = await walk(root);
const htmlFiles = files.filter((f) => extname(f) === '.html');

if (htmlFiles.length === 0) {
  console.error(`✖ no HTML files found under ${root}`);
  process.exit(1);
}

// Build a set of "URL paths" the build produced, for internal-link resolution.
// Astro directory mode: /page/ -> dist/page/index.html; root -> dist/index.html.
// /download is a Worker route (wrangler.jsonc run_worker_first), not a static
// file, so it's seeded here to keep the internal-link walker from flagging it dead.
const paths = new Set(['/', '/download']);
for (const f of files) {
  let rel = f.slice(root.length).replace(/\\/g, '/');
  if (rel.endsWith('/index.html')) rel = rel.slice(0, -'index.html'.length) || '/';
  else if (rel.endsWith('.html')) rel = rel.slice(0, -'.html'.length);
  if (!rel.startsWith('/')) rel = '/' + rel;
  paths.add(rel);
}

const external = /^(https?:|mailto:|tel:|data:)/i;
const problems = [];

// Read each built page once and reuse the content across every check below.
const htmlByFile = new Map(
  await Promise.all(htmlFiles.map(async (file) => [file, await readFile(file, 'utf8')])),
);

for (const file of htmlFiles) {
  const html = htmlByFile.get(file);
  for (const raw of hrefs(html)) {
    if (external.test(raw)) continue;
    if (raw.startsWith('#')) continue; // in-page anchor
    const [pathPart] = raw.split('#');
    const normalized = normalize(pathPart) || '/';
    let p = normalized;
    if (!p.startsWith('/')) p = '/' + p;
    if (paths.has(p)) continue;
    // Some links may point at /folder that exists as /folder/ (trailing slash).
    if (paths.has(p.replace(/\/$/, '')) || paths.has(p + '/')) continue;
    problems.push(`${file.slice(root.length)}: dead internal link "${raw}"`);
  }
}

if (problems.length) {
  console.error(`✖ ${problems.length} dead internal link(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

// #502 — download CTAs must route through /download (which resolves the
// latest.json manifest at request time), never regress to the GitHub
// releases page directly.
const releasesPageCtaRe = /sound-buddy-releases\/releases\/latest(?!\/download\/)/;
for (const file of htmlFiles) {
  if (releasesPageCtaRe.test(htmlByFile.get(file))) {
    console.error(
      `✖ download CTA points at the GitHub releases page — CTAs must route through /download (stable release channel, #502)`,
    );
    process.exit(1);
  }
}

const indexHtml = htmlByFile.get(join(root, 'index.html'));
if (!indexHtml.includes('href="/download"')) {
  console.error('✖ index.html has no /download CTA — the stable download channel is not wired');
  process.exit(1);
}

// #556 — /record-your-service explains step 1 of the funnel but nothing linked to
// it. Every built page's footer must carry a link there so it's reachable from
// anywhere on the site (it links to itself via LegalLayout's own footer, which is
// fine and expected).
const missingGuideLink = [];
for (const file of htmlFiles) {
  if (!htmlByFile.get(file).includes('href="/record-your-service"')) {
    missingGuideLink.push(file.slice(root.length));
  }
}
if (missingGuideLink.length) {
  console.error(`✖ ${missingGuideLink.length} page(s) missing the recording-guide footer link:`);
  for (const f of missingGuideLink) {
    console.error(`  ${f}: add <a href="/record-your-service">Recording guide</a> to this page's footer nav`);
  }
  process.exit(1);
}

console.log(`✓ ${files.length} files, ${htmlFiles.length} page(s), internal links OK, /download CTA present, recording-guide link present on every page.`);