// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// ─── Prompt drift guard (TD-004, #398) ─────────────────────────────────────
//
// The app used to keep its own hand-copied system-prompt string literals
// (trigger-llm-analysis's engineer prompt, the live-capture interval's
// live-monitoring prompt) that drifted from the canonical copies in
// @sound-buddy/audio-engine/src/prompts/. This slice deletes both literals
// in favor of loadEnginePrompts() (./ipc/engine-loader.ts). This test guards
// against the literal reappearing: it scans every non-test TypeScript file
// under app/electron for the telltale opening words of a hardcoded system
// prompt and fails if one shows up again.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const DRIFT_MARKER = 'You are a professional';

function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('no hardcoded system-prompt literals remain in app/electron', () => {
  const files = collectTsFiles(electronRoot);

  it.each(files.map((f) => [path.relative(electronRoot, f), f] as const))(
    '%s does not contain a hardcoded system-prompt literal',
    (_relative, file) => {
      const text = fs.readFileSync(file, 'utf8');
      expect(text).not.toContain(DRIFT_MARKER);
    },
  );
});
