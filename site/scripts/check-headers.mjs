// Guard the built site's security headers: asserts dist/_headers exists,
// carries the required header set with the right values on the `/*` rule,
// and stays consistent with the build (no inline <script> tags — those would
// be blocked by the strict script-src 'self' CSP below).
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const headersPath = join(root, '_headers');

const REQUIRED_HEADERS = [
  'Content-Security-Policy',
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Strict-Transport-Security',
];

const EXPECTED_VALUES = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

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

const problems = [];

let headersText;
try {
  headersText = await readFile(headersPath, 'utf8');
} catch {
  console.error(`✖ ${headersPath} does not exist.`);
  console.error('  Create site/public/_headers with the standard security header set.');
  process.exit(1);
}

const lines = headersText.split('\n');
const firstRuleIdx = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
if (firstRuleIdx === -1 || lines[firstRuleIdx].trim() !== '/*') {
  problems.push('First rule in _headers must be "/*" so headers apply to every route.');
}

// Collect indented "Header-Name: value" lines that follow the /* rule, until
// the next non-indented, non-comment line (a new path rule) or EOF.
const ruleHeaders = new Map();
for (let i = firstRuleIdx + 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  if (!/^\s/.test(line)) break; // new rule path, stop
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) continue;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) continue;
  const name = trimmed.slice(0, colonIdx).trim();
  const value = trimmed.slice(colonIdx + 1).trim();
  ruleHeaders.set(name.toLowerCase(), { name, value });
}

for (const required of REQUIRED_HEADERS) {
  if (!ruleHeaders.has(required.toLowerCase())) {
    problems.push(`_headers is missing "${required}" under the /* rule.`);
  }
}

for (const [name, expected] of Object.entries(EXPECTED_VALUES)) {
  const found = ruleHeaders.get(name.toLowerCase());
  if (found && found.value !== expected) {
    problems.push(`${name} must be "${expected}", got "${found.value}".`);
  }
}

const hsts = ruleHeaders.get('strict-transport-security'.toLowerCase());
if (hsts && !hsts.value.includes('max-age=')) {
  problems.push('Strict-Transport-Security must contain "max-age=".');
}

const csp = ruleHeaders.get('content-security-policy'.toLowerCase());
if (csp) {
  if (/unsafe-eval/i.test(csp.value)) {
    problems.push("Content-Security-Policy must not contain 'unsafe-eval' anywhere.");
  }
  const scriptSrcMatch = csp.value.match(/script-src\s+([^;]+)/i);
  if (scriptSrcMatch && /unsafe-inline/i.test(scriptSrcMatch[1])) {
    problems.push("Content-Security-Policy script-src must not contain 'unsafe-inline'.");
  }
}

const files = await walk(root);
const htmlFiles = files.filter((f) => extname(f) === '.html');
const inlineScriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>/i;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  if (inlineScriptRe.test(html)) {
    problems.push(
      `${file.slice(root.length)}: contains an inline <script> tag (no src=) — the ` +
        "script-src 'self' CSP will block it. Keep vite.build.assetsInlineLimit: 0 " +
        'in astro.config.mjs so Astro emits scripts as external files.',
    );
  }
}

const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
if (!/<script\s+type="module"\s+src=/.test(indexHtml)) {
  problems.push(
    'index.html has no external module script (<script type="module" src=...>) — ' +
      'expected the countdown timer to be externalized by vite.build.assetsInlineLimit: 0.',
  );
}

if (problems.length) {
  console.error(`✖ ${problems.length} header problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ _headers present, required headers set correctly, CSP strict, no inline scripts.');
