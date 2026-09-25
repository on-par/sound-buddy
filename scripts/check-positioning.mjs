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
      'README.md',                  // docs — architecture overview
      // app/renderer/src/SettingsPanel.tsx dropped the AI provider settings pane
      // entirely (#657) — the renderer no longer advertises AI configuration
      // that can't run in a packaged build. Restore this surface once #658/#659
      // bring a working AI settings UI back.
    ],
    forbidden: [
      { text: 'Works with your existing AI', in: ['site/src/pages/index.astro'] },
    ],
  },
  {
    // #1527 / ADR-0147 retired this phrase from the public landing: global
    // local-only claims are banned in marketing copy now that Free is a
    // browser product. It stays locked on the Pro/desktop surfaces below,
    // and site/src/lib/packaging-copy.ts's GLOBAL_PRIVACY_CLAIM_PATTERNS
    // keeps it (and its paraphrases) off site landing/FAQ copy.
    phrase: 'Your audio never leaves your machine',
    required: [
      'app/renderer/src/settings-help.ts',  // app — usage-signal note copy (#1007 moved the Settings row notes out of SettingsPanel.tsx's JSX into this single-source-of-truth table)
      'README.md',                          // docs — top-level positioning
    ],
    forbidden: [],
  },
  {
    // #91 — Pro/desktop has no usage caps. The Free web tier is capped at
    // FREE_MONTHLY_UPLOADS uploads a month under the #1518 product lock, so
    // this line must stay scoped to Pro.
    phrase: 'Unlimited recordings. Stored on your machine.',
    required: [
      'site/src/lib/packaging-copy.ts',     // landing — Pro tier feature list (#1527)
      'app/renderer/src/SettingsPanel.tsx', // app — Storage settings tab (#204: index.html's static dialog markup was fully absorbed into this React island)
      'README.md',                          // docs — top-level positioning
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
