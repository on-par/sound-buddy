// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// AI carve-out 2/5 (#658): removes the AI-narrative IPC channel end to end —
// the ipc/narrative.ts handler module (all six handlers), the llm-delta/
// llm-done push channels, the eight preload bridge methods, the LlmApi slice
// of SoundBuddyApi, and the live-capture LLM interval timer — so the app's
// trusted preload surface stops carrying a channel with no caller (the
// renderer UI was removed in #657). The provider stack (llm.ts,
// llm-config.ts, llm-providers.ts, ollama-probe.ts, narrative-port.ts) is
// left for #659. The banned tokens are built by string concatenation below
// (never spelled out literally in this file, including in prose) so this
// file itself never trips its own greps.

const TOKENS = [
  'trigger-' + 'llm-analysis',
  'llm-' + 'delta',
  'llm-' + 'done',
  'llm-get-' + 'config',
  'llm-save-' + 'config',
  'llm-detect-' + 'ollama',
  'llm-test-' + 'provider',
  'llm-list-' + 'models',
  'trigger' + 'LlmAnalysis',
  'on' + 'LlmDelta',
  'on' + 'LlmDone',
  'get' + 'LlmConfig',
  'save' + 'LlmConfig',
  'detect' + 'Ollama',
  'test' + 'LlmProvider',
  'list' + 'LlmModels',
  'stream' + 'LLM',
  'Llm' + 'Api',
  'registerNarrative' + 'Handlers',
];

const files: Record<string, string> = {
  'preload.ts': fs.readFileSync(fileURLToPath(new URL('./preload.ts', import.meta.url)), 'utf8'),
  'ipc.ts': fs.readFileSync(fileURLToPath(new URL('./ipc.ts', import.meta.url)), 'utf8'),
  'ipc/api.ts': fs.readFileSync(fileURLToPath(new URL('./ipc/api.ts', import.meta.url)), 'utf8'),
  'ipc/live-capture.ts': fs.readFileSync(fileURLToPath(new URL('./ipc/live-capture.ts', import.meta.url)), 'utf8'),
  '../renderer/src/mock-sound-buddy.ts': fs.readFileSync(
    fileURLToPath(new URL('../renderer/src/mock-sound-buddy.ts', import.meta.url)),
    'utf8',
  ),
};

describe('AI carve-out gate (#658)', () => {
  for (const [name, content] of Object.entries(files)) {
    for (const token of TOKENS) {
      it(`${name} does not contain the removed-surface token "${token}"`, () => {
        expect(content).not.toContain(token);
      });
    }
  }

  it('the narrative IPC handler module no longer exists', () => {
    expect(fs.existsSync(fileURLToPath(new URL('./ipc/' + 'narrative.ts', import.meta.url)))).toBe(false);
    expect(fs.existsSync(fileURLToPath(new URL('./ipc/' + 'narrative.test.ts', import.meta.url)))).toBe(false);
  });
});
