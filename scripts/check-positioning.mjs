#!/usr/bin/env node
// Positioning-consistency guard (#80, #79). Our brand philosophy lines are locked
// wording, not taglines to paraphrase — Clara owns them. This script is the single
// source of truth for each locked phrase: it asserts the exact string appears
// verbatim on every surface that uses it, and that retired paraphrases don't creep
// back in. Wired into scripts/verify.sh and CI.
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);

// THE locked phrases. Change wording here and nowhere else; every listed surface
// must match verbatim (as a substring — trailing punctuation or an em-dash
// continuation is fine, paraphrasing is not). `forbidden` lists retired
// paraphrases that must not reappear on the named user-facing product surfaces.
// (Internal strategy docs may still discuss a concept in their own words — this
// only guards each phrase's canonical placements.)
const LOCKED = [
  {
    phrase: 'Works with the AI you already have',
    required: [
      'site/src/pages/index.astro', // landing — trust section
      'app/renderer/index.html',    // app — AI provider settings
      'README.md',                  // docs — architecture overview
    ],
    forbidden: [
      { text: 'Works with your existing AI', in: ['site/src/pages/index.astro', 'app/renderer/index.html'] },
    ],
  },
  {
    phrase: 'Your audio never leaves your machine',
    required: [
      'site/src/pages/index.astro', // landing — privacy callout (headline-level)
      'app/renderer/index.html',    // app — AI settings privacy note
      'README.md',                  // docs — top-level positioning
    ],
    forbidden: [],
  },
];

const problems = [];

for (const { phrase, required, forbidden } of LOCKED) {
  for (const rel of required) {
    const body = await readFile(new URL(rel, repoRoot), 'utf8').catch(() => null);
    if (body === null) {
      problems.push(`missing surface: ${rel}`);
    } else if (!body.includes(phrase)) {
      problems.push(`${rel}: locked phrase "${phrase}" not found verbatim`);
    }
  }

  for (const { text, in: files } of forbidden) {
    for (const rel of files) {
      const body = await readFile(new URL(rel, repoRoot), 'utf8').catch(() => null);
      if (body !== null && body.includes(text)) {
        problems.push(`${rel}: retired paraphrase "${text}" — use "${phrase}"`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('✖ positioning check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const summary = LOCKED.map((l) => `"${l.phrase}"`).join(', ');
console.log(`✓ positioning consistent — ${summary} verbatim across their surfaces`);
