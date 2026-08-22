// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Executable form of the #884 ADR's "no write path exists" acceptance
// criterion, widened by #977's ADR to cover the live channel-state poll: the
// console IPC surface is read-only by construction. #889 adds local scene
// capture: the console walk is still read-only (/node), and the only write is
// a completed `.local.scn` file under app-managed storage. A future slice that
// needs a console write path must delete/rewrite this gate in the same PR — a
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
const consoleMetersTs = fs.readFileSync(
  fileURLToPath(new URL('../../electron/ipc/console-meters.ts', import.meta.url)),
  'utf8'
);
const consoleSubscriptionTs = fs.readFileSync(
  fileURLToPath(new URL('../../electron/ipc/console-subscription.ts', import.meta.url)),
  'utf8'
);
const consoleLinkTs = fs.readFileSync(fileURLToPath(new URL('../../electron/ipc/console-link.ts', import.meta.url)), 'utf8');
const consoleSceneCaptureTs = fs.readFileSync(
  fileURLToPath(new URL('../../electron/ipc/console-scene-capture.ts', import.meta.url)),
  'utf8'
);

// OSC/console write vocabulary that has no legitimate reason to appear in
// any of the three files below. Deliberately excludes bare "set"/"store" —
// those collide with this domain's own legitimate vocabulary (getSettings,
// setManualIp, createConsoleStore/useConsoleStore, the Zustand `set()`
// updater) which is local UI/settings state, not a console write.
const WRITE_VERB_PATTERN =
  /\/set\/|\/recall|\bsaveScene\b|\bstoreScene\b|\bwriteConsole\b|\bsetFader\b|\bmuteChannel\b|\bunmuteChannel\b|\brecallScene\b/i;

describe('Console IPC surface is read-only by construction (#884 ADR, #977 ADR, #889)', () => {
  it('registers only the known read/local-capture ipcMain.handle channels', () => {
    const matches = [...consoleIpcTs.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(matches).toEqual([
      'scan-consoles',
      'fetch-console-identity',
      'start-console-live-state',
      'stop-console-live-state',
      'start-console-scene-capture',
      'cancel-console-scene-capture',
    ]);
  });

  it.each([
    ['app/electron/ipc/console.ts', () => consoleIpcTs],
    ['app/electron/ipc/console-channel-state.ts', () => consoleChannelStateTs],
    ['app/electron/ipc/console-meters.ts', () => consoleMetersTs],
    ['app/electron/ipc/console-subscription.ts', () => consoleSubscriptionTs],
    ['app/electron/ipc/console-link.ts', () => consoleLinkTs],
    ['app/electron/ipc/console-scene-capture.ts', () => consoleSceneCaptureTs],
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

  it('console-scene-capture.ts sends only /node requests and writes only after the complete read succeeds', () => {
    const addresses = [...consoleSceneCaptureTs.matchAll(/queryConsole\([\s\S]{0,200}?'(\/[^']+)'/g)].map((m) => m[1]);
    expect(addresses).toEqual(['/node']);
    expect(consoleSceneCaptureTs.indexOf('captureSceneFromConsole')).toBeLessThan(consoleSceneCaptureTs.indexOf('deps.writeFile'));
  });

  it('the meter path opens no write address — only /renew and /xremote reads, decoding /meters/1', () => {
    const quoted = [...`${consoleMetersTs}\n${consoleSubscriptionTs}`.matchAll(/'(\/[a-z0-9/]+)'/gi)].map((m) => m[1]);
    const uniqueSorted = [...new Set(quoted)].sort();
    expect(uniqueSorted).toEqual(['/renew', '/xremote']);
    expect(consoleMetersTs).toContain('METERS_1_ADDRESS');
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
        /\.stopLiveState\(\)/.test(upToNextTag) ||
        /\.startSceneCapture\(\)/.test(upToNextTag) ||
        /\.cancelSceneCapture\(\)/.test(upToNextTag) ||
        /\.compareLastSceneCaptures\(\)/.test(upToNextTag);
      expect(isKnownReadAction).toBe(true);
    }
  });

  it('the live channel rows are display-only — no interactive element inside them', () => {
    const start = consolePanelTsx.indexOf('id="console-channel-list"');
    expect(start).toBeGreaterThan(-1);
    const block = consolePanelTsx.slice(start, consolePanelTsx.indexOf('</ul>', start));
    expect(block).toContain('console-channel-meter');
    for (const forbidden of ['<button', '<input', 'onClick', 'onChange']) {
      expect(block).not.toContain(forbidden);
    }
  });
});
