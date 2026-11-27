// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const mixerDir = path.join(srcDir, 'mixer');

const MIXER_FILES: Record<string, string> = Object.fromEntries(
  [
    path.join(srcDir, 'MixerPanel.tsx'),
    path.join(srcDir, 'stores', 'mixerStore.ts'),
    ...fs
      .readdirSync(mixerDir)
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
      .map((f) => path.join(mixerDir, f)),
  ].map((file) => [path.relative(srcDir, file), fs.readFileSync(file, 'utf8')])
);

const WRITE_VERB_PATTERN =
  /\/set\/|\/recall|\bsaveScene\b|\bstoreScene\b|\bwriteConsole\b|\bsetFader\b|\bmuteChannel\b|\bunmuteChannel\b|\brecallScene\b/i;

const ALLOWED_STORE_CALLS = new Set([
  'startLiveState',
  'updateSettings',
  'inspectChannel',
  'dismissCard',
  'dismissMove',
  'showView',
  'toggleSermonQuiet',
  'watchChannel',
  'ingestConsole',
  'ingestRoom',
  'ask',
  'cancel',
  'refreshStatus',
]);

const BRIDGE_TOKENS = ['getSoundBuddy', 'useElectron', 'soundBuddy', 'ipcRenderer', 'ipcMain', 'window.'];

function buttonBlock(source: string, className: string): string {
  const at = source.indexOf(className);
  const start = source.lastIndexOf('<button', at);
  return source.slice(start, source.indexOf('</button>', at));
}

describe('Mixer is read-only by construction', () => {
  it('scans the Mixer panel, store and every mixer module', () => {
    expect(Object.keys(MIXER_FILES)).toEqual(
      expect.arrayContaining(['MixerPanel.tsx', 'stores/mixerStore.ts', 'mixer/MixerRail.tsx', 'mixer/rules.ts', 'mixer/attention.ts'])
    );
  });

  it.each(Object.entries(MIXER_FILES))('%s never references encodeOscMessage', (_name, source) => {
    expect(source).not.toContain('encodeOscMessage');
  });

  it.each(Object.entries(MIXER_FILES))('%s contains no console write-verb vocabulary', (_name, source) => {
    expect(source).not.toMatch(WRITE_VERB_PATTERN);
  });

  it.each(Object.entries(MIXER_FILES))('%s reaches no bridge or IPC method directly', (_name, source) => {
    for (const token of BRIDGE_TOKENS) expect(source).not.toContain(token);
  });

  it.each(Object.entries(MIXER_FILES))('%s calls only console read actions, settings and its own UI actions', (_name, source) => {
    const calls = [...source.matchAll(/\.getState\(\)\.(\w+)\(/g)].map((m) => m[1]);
    for (const call of calls) expect(ALLOWED_STORE_CALLS.has(call), `unexpected store call ${call}`).toBe(true);
  });

  it('the only console action the Mixer triggers is the existing start-live-state read', () => {
    const consoleCalls = Object.values(MIXER_FILES).flatMap((source) =>
      [...source.matchAll(/useConsoleStore\.getState\(\)\.(\w+)\(/g)].map((m) => m[1])
    );
    expect(new Set(consoleCalls)).toEqual(new Set(['startLiveState']));
  });

  it('Apply to Board carries disabled and no handler', () => {
    const block = buttonBlock(MIXER_FILES['mixer/MixerRail.tsx'], 'mx-apply');
    expect(block).toContain('Apply to Board');
    expect(block).toMatch(/\sdisabled[\s>]/);
    expect(block).not.toContain('onClick');
  });

  it('Undo carries disabled and no handler', () => {
    const block = buttonBlock(MIXER_FILES['mixer/MixerRail.tsx'], 'mx-undo');
    expect(block).toContain('Undo');
    expect(block).toMatch(/\sdisabled[\s>]/);
    expect(block).not.toContain('onClick');
  });

  it('the composer is disabled unless an assist is healthy, and its only handler sends the question to the assist store', () => {
    const source = MIXER_FILES['mixer/MixerRail.tsx'];
    const start = source.indexOf('<input', source.indexOf('className={COMPOSER_CLASS}'));
    const input = source.slice(start, source.indexOf('/>', start));
    expect(input).toContain('disabled={!assist.composerEnabled}');
    expect(input).not.toMatch(/onChange|onKeyDown|onSubmit|onClick/);
    const ask = buttonBlock(source, 'mx-composer-ask');
    expect(ask).toContain('disabled={!assist.composerEnabled}');
    expect(ask).toContain('onClick={(e) => void askFromComposer(e)}');
  });

  it('assist answers never create or edit a proposed move', () => {
    const assistStore = fs.readFileSync(path.join(srcDir, 'stores', 'mixerAssistStore.ts'), 'utf8');
    for (const token of ['proposed-moves', 'moves', 'dismissMove', 'useMixerStore.setState', 'mixer.setState']) expect(assistStore).not.toContain(token);
    expect(MIXER_FILES['stores/mixerStore.ts']).not.toContain('mixerAssistStore');
    expect(MIXER_FILES['mixer/proposed-moves.ts']).not.toContain('assist');
  });
});
