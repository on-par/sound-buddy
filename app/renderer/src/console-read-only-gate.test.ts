// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Executable form of the #884 ADR's "no write path exists" acceptance
// criterion: the console IPC surface is read-only by construction. A future
// slice that needs a write path must delete/rewrite this gate in the same
// PR — a visible, reviewable decision instead of a silent one.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const consoleIpcTs = fs.readFileSync(fileURLToPath(new URL('../../electron/ipc/console.ts', import.meta.url)), 'utf8');
const consolePanelTsx = fs.readFileSync(fileURLToPath(new URL('./ConsolePanel.tsx', import.meta.url)), 'utf8');
const consoleStoreTs = fs.readFileSync(fileURLToPath(new URL('./stores/consoleStore.ts', import.meta.url)), 'utf8');

// OSC/console write vocabulary that has no legitimate reason to appear in
// any of the three files below. Deliberately excludes bare "set"/"store" —
// those collide with this domain's own legitimate vocabulary (getSettings,
// setManualIp, createConsoleStore/useConsoleStore, the Zustand `set()`
// updater) which is local UI/settings state, not a console write.
const WRITE_VERB_PATTERN =
  /\/set\/|\/recall|\bsaveScene\b|\bstoreScene\b|\bwriteConsole\b|\bsetFader\b|\bmuteChannel\b|\bunmuteChannel\b|\brecallScene\b/i;

describe('Console IPC surface is read-only by construction (#884 ADR)', () => {
  it('registers exactly two ipcMain.handle channels: scan-consoles and fetch-console-identity', () => {
    const matches = [...consoleIpcTs.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(matches).toEqual(['scan-consoles', 'fetch-console-identity']);
  });

  it.each([
    ['app/electron/ipc/console.ts', () => consoleIpcTs],
    ['app/renderer/src/ConsolePanel.tsx', () => consolePanelTsx],
    ['app/renderer/src/stores/consoleStore.ts', () => consoleStoreTs],
  ])('%s contains no console write-verb vocabulary', (_label, getSrc) => {
    expect(getSrc()).not.toMatch(WRITE_VERB_PATTERN);
  });

  it.each([
    ['app/electron/ipc/console.ts', () => consoleIpcTs],
    ['app/renderer/src/ConsolePanel.tsx', () => consolePanelTsx],
    ['app/renderer/src/stores/consoleStore.ts', () => consoleStoreTs],
  ])('%s never calls encodeOscMessage directly (writes stay inside the read-only delegated modules)', (_label, getSrc) => {
    expect(getSrc()).not.toContain('encodeOscMessage');
  });

  it('ConsolePanel.tsx has no <form action, and every button maps to a known read action', () => {
    expect(consolePanelTsx).not.toMatch(/<form action/);

    const buttonBlocks = consolePanelTsx.split('<button').slice(1);
    expect(buttonBlocks.length).toBeGreaterThan(0);
    for (const block of buttonBlocks) {
      const upToNextTag = block.slice(0, block.indexOf('>') + 200);
      const isKnownReadAction =
        /\.scan\(\)/.test(upToNextTag) ||
        /\.selectConsole\(/.test(upToNextTag) ||
        /\.submitManualIp\(\)/.test(upToNextTag);
      expect(isKnownReadAction).toBe(true);
    }
  });
});
