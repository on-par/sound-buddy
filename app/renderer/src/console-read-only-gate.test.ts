// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Executable form of the #884 ADR's "no write path exists" acceptance
// criterion, widened by #977's ADR to cover the live channel-state poll: the
// console IPC surface is read-only by construction. A future slice that
// needs a write path must delete/rewrite this gate in the same PR — a
// visible, reviewable decision instead of a silent one.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const consoleIpcTs = fs.readFileSync(fileURLToPath(new URL('../../electron/ipc/console.ts', import.meta.url)), 'utf8');
const consolePanelTsx = fs.readFileSync(fileURLToPath(new URL('./ConsolePanel.tsx', import.meta.url)), 'utf8');
const consoleStoreTs = fs.readFileSync(fileURLToPath(new URL('./stores/consoleStore.ts', import.meta.url)), 'utf8');
const consoleChannelStateTs = fs.readFileSync(
  fileURLToPath(new URL('../../electron/ipc/console-channel-state.ts', import.meta.url)),
  'utf8'
);

// OSC/console write vocabulary that has no legitimate reason to appear in
// any of the three files below. Deliberately excludes bare "set"/"store" —
// those collide with this domain's own legitimate vocabulary (getSettings,
// setManualIp, createConsoleStore/useConsoleStore, the Zustand `set()`
// updater) which is local UI/settings state, not a console write.
const WRITE_VERB_PATTERN =
  /\/set\/|\/recall|\bsaveScene\b|\bstoreScene\b|\bwriteConsole\b|\bsetFader\b|\bmuteChannel\b|\bunmuteChannel\b|\brecallScene\b/i;

describe('Console IPC surface is read-only by construction (#884 ADR, #977 ADR)', () => {
  it('registers exactly four ipcMain.handle channels: scan-consoles, fetch-console-identity, start-console-live-state, stop-console-live-state', () => {
    const matches = [...consoleIpcTs.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(matches).toEqual([
      'scan-consoles',
      'fetch-console-identity',
      'start-console-live-state',
      'stop-console-live-state',
    ]);
  });

  it.each([
    ['app/electron/ipc/console.ts', () => consoleIpcTs],
    ['app/electron/ipc/console-channel-state.ts', () => consoleChannelStateTs],
    ['app/renderer/src/ConsolePanel.tsx', () => consolePanelTsx],
    ['app/renderer/src/stores/consoleStore.ts', () => consoleStoreTs],
  ])('%s contains no console write-verb vocabulary', (_label, getSrc) => {
    expect(getSrc()).not.toMatch(WRITE_VERB_PATTERN);
  });

  it.each([
    ['app/electron/ipc/console.ts', () => consoleIpcTs],
    ['app/electron/ipc/console-channel-state.ts', () => consoleChannelStateTs],
    ['app/renderer/src/ConsolePanel.tsx', () => consolePanelTsx],
    ['app/renderer/src/stores/consoleStore.ts', () => consoleStoreTs],
  ])('%s never calls encodeOscMessage directly (writes stay inside the read-only delegated modules)', (_label, getSrc) => {
    expect(getSrc()).not.toContain('encodeOscMessage');
  });

  it('console-channel-state.ts sends only /node requests', () => {
    const addresses = [...consoleChannelStateTs.matchAll(/queryConsole\([\s\S]{0,200}?'(\/[^']+)'/g)].map((m) => m[1]);
    expect(addresses).toEqual(['/node']);
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
        /\.submitManualIp\(\)/.test(upToNextTag) ||
        /\.startLiveState\(\)/.test(upToNextTag) ||
        /\.stopLiveState\(\)/.test(upToNextTag);
      expect(isKnownReadAction).toBe(true);
    }
  });

  it('the live channel rows are display-only — no interactive element inside them', () => {
    const start = consolePanelTsx.indexOf('id="console-live-channels"');
    expect(start).toBeGreaterThan(-1);
    const block = consolePanelTsx.slice(start, consolePanelTsx.indexOf('</ul>', start));
    for (const forbidden of ['<button', '<input', 'onClick', 'onChange']) {
      expect(block).not.toContain(forbidden);
    }
  });
});
