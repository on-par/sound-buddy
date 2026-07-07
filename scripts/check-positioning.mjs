#!/usr/bin/env node
// Positioning-consistency guard (#80). "Works with the AI you already have" is a
// locked brand philosophy, not a tagline to paraphrase — Clara owns the wording.
// This script is the single source of truth for that phrase: it asserts the exact
// string appears verbatim on every surface that uses it, and that retired
// paraphrases don't creep back in. Wired into scripts/verify.sh and CI.
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);

// THE locked phrase. Change it here and nowhere else; every surface must match.
const PHRASE = 'Works with the AI you already have';

// Surfaces that must contain the phrase verbatim (as a substring — trailing
// punctuation or an em-dash continuation is fine, paraphrasing is not).
const REQUIRED = [
  'site/src/pages/index.astro', // landing — trust section
  'app/renderer/index.html',    // app — AI provider settings
  'README.md',                  // docs — architecture overview
];

// Retired paraphrases that must not reappear on user-facing product surfaces.
// (Internal strategy docs like docs/revenue-model.md may still discuss the
// "bring your own AI" concept in their own words — this only guards the phrase's
// canonical placements.)
const FORBIDDEN = [
  { text: 'Works with your existing AI', in: ['site/src/pages/index.astro', 'app/renderer/index.html'] },
];

const problems = [];

for (const rel of REQUIRED) {
  const body = await readFile(new URL(rel, repoRoot), 'utf8').catch(() => null);
  if (body === null) {
    problems.push(`missing surface: ${rel}`);
  } else if (!body.includes(PHRASE)) {
    problems.push(`${rel}: locked phrase "${PHRASE}" not found verbatim`);
  }
}

for (const { text, in: files } of FORBIDDEN) {
  for (const rel of files) {
    const body = await readFile(new URL(rel, repoRoot), 'utf8').catch(() => null);
    if (body !== null && body.includes(text)) {
      problems.push(`${rel}: retired paraphrase "${text}" — use "${PHRASE}"`);
    }
  }
}

if (problems.length > 0) {
  console.error('✖ positioning check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ positioning consistent — "${PHRASE}" verbatim across ${REQUIRED.length} surfaces`);
