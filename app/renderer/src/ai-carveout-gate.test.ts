// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// AI carve-out 1/5 (#657): removes every AI Engineer UI surface from the
// renderer — the standing AI side rail, the inline docked report-card
// summary, the "Analyze with AI" button/countdown/output, the LLM Interval
// slider, the AI Engineer settings tab, and the narrative Zustand store — so
// the app stops advertising a feature that cannot run in a packaged build
// (#658/#659 own the IPC/main-process/preload slices; renderer-only here).
// The banned tokens are built by string concatenation below (never spelled
// out literally in this file, including in prose) so this file itself never
// trips the repo's acceptance grep over app/renderer for those four tokens.

const TOKENS = [
  'narrative' + 'Store',
  'ai-' + 'panel',
  'rc-ai-' + 'dock',
  'ai-' + 'only',
];

const ROOT_MARKUP_ONLY_TOKENS = [
  'sync' + 'AiDock',
  'ai-' + 'output',
  'ai-' + 'countdown',
  'ai-' + 'analyze-btn',
  'model-' + 'chip',
  'llm-' + 'interval',
];

const files: Record<string, string> = {
  'root-markup.html': fs.readFileSync(fileURLToPath(new URL('./root-markup.html', import.meta.url)), 'utf8'),
  'inline-app.js': fs.readFileSync(fileURLToPath(new URL('./inline-app.js', import.meta.url)), 'utf8'),
  'App.tsx': fs.readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8'),
  'SettingsPanel.tsx': fs.readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8'),
  'styles/app.css': fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8'),
  'styles/tokens.css': fs.readFileSync(fileURLToPath(new URL('./styles/tokens.css', import.meta.url)), 'utf8'),
  'stores/bridge.ts': fs.readFileSync(fileURLToPath(new URL('./stores/bridge.ts', import.meta.url)), 'utf8'),
  'stores/settingsStore.ts': fs.readFileSync(fileURLToPath(new URL('./stores/settingsStore.ts', import.meta.url)), 'utf8'),
  'stores/liveCaptureStore.ts': fs.readFileSync(fileURLToPath(new URL('./stores/liveCaptureStore.ts', import.meta.url)), 'utf8'),
  '../index.html': fs.readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8'),
  '../single-column-state.js': fs.readFileSync(fileURLToPath(new URL('../single-column-state.js', import.meta.url)), 'utf8'),
  '../upgrade-momentum.js': fs.readFileSync(fileURLToPath(new URL('../upgrade-momentum.js', import.meta.url)), 'utf8'),
};

describe('AI carve-out gate (#657)', () => {
  for (const [name, content] of Object.entries(files)) {
    for (const token of TOKENS) {
      it(`${name} does not contain the removed-surface token "${token}"`, () => {
        expect(content).not.toContain(token);
      });
    }
  }

  for (const token of ROOT_MARKUP_ONLY_TOKENS) {
    it(`root-markup.html does not contain the removed-surface token "${token}"`, () => {
      expect(files['root-markup.html']).not.toContain(token);
    });

    it(`inline-app.js does not contain the removed-surface token "${token}"`, () => {
      expect(files['inline-app.js']).not.toContain(token);
    });
  }

  // The narrative store's source and its colocated test are gone outright —
  // that Zustand store backed the removed "Analyze with AI" button.
  it('the narrative store module no longer exists', () => {
    expect(fs.existsSync(fileURLToPath(new URL('./stores/' + 'narrative' + 'Store.ts', import.meta.url)))).toBe(false);
    expect(fs.existsSync(fileURLToPath(new URL('./stores/' + 'narrative' + 'Store.test.ts', import.meta.url)))).toBe(false);
  });

  // The dock-placement helper (and its test) that moved the AI rail into the
  // report card is gone outright — the rail itself no longer exists to dock.
  it('the AI dock state helper module no longer exists', () => {
    expect(fs.existsSync(fileURLToPath(new URL('../' + 'ai-dock-state.js', import.meta.url)))).toBe(false);
    expect(fs.existsSync(fileURLToPath(new URL('../' + 'ai-dock-state.test.ts', import.meta.url)))).toBe(false);
  });

  it('the dedicated dock-gate test file no longer exists (its whole subject was the dock)', () => {
    expect(fs.existsSync(fileURLToPath(new URL('./' + 'ai-dock-gate.test.ts', import.meta.url)))).toBe(false);
  });
});
