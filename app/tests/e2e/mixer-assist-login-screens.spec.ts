// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parseChannelStrips } from '@sound-buddy/console/dist-cjs/index.js';
import { launchApp, withRetry } from './e2e-helpers';

const SHOTS_DIR = process.env.SB_MIXER_SHOTS_DIR;
const WIDTH = 1440;
const HEIGHT = 900;
const IP = '10.0.0.50';
const CHANNELS = 32;
const CLIPPING: Record<number, number> = { 2: 1.6, 5: 1.35 };
const MISSING_LINE = "Claude Code isn't installed on this Mac.";
const SIGNED_OUT_LINE = "Claude Code isn't signed in. Run claude in Terminal and sign in";
const TOKEN_COPY = ['Paste token', 'write-only token', 'Token saved', 'setup-token'];

const scene = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'console', 'src', 'capture-2026-08-16.scn'), 'utf8');

type Cloud = {
  enabled: boolean;
  binaryFound: boolean;
  tokenSaved: boolean;
  encryptionAvailable: null;
  lastFailure: string | null;
  auth: 'login';
  storedToken: boolean;
};
type Status = { cloud: Cloud; local: { enabled: boolean; endpoint: string; modelSet: boolean; lastFailure: string | null }; inFlight: boolean };

const READY: Status = {
  cloud: { enabled: true, binaryFound: true, tokenSaved: false, encryptionAvailable: null, lastFailure: null, auth: 'login', storedToken: false },
  local: { enabled: false, endpoint: 'unset', modelSet: false, lastFailure: null },
  inFlight: false,
};
const withCloud = (cloud: Partial<Cloud>): Status => ({ ...READY, cloud: { ...READY.cloud, ...cloud } });

let electronApp: ElectronApplication;
let window: Page;

function channelsEvent() {
  return {
    channels: parseChannelStrips(scene).map((s) => ({ index: s.index, name: s.name, faderDb: s.fader, on: s.on, color: s.color, icon: s.icon, dynamics: s.dynamics })),
    readAt: Date.now(),
  };
}

function metersEvent() {
  const inputs = Array.from({ length: CHANNELS }, (_, i) => CLIPPING[i + 1] ?? 0.15);
  return { meters: { inputs, gateGainReduction: Array(CHANNELS).fill(0), dynamicsGainReduction: Array(CHANNELS).fill(0) } };
}

async function push(events: unknown[]): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, evts) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    for (const e of evts) wc.send('console-live-state', e);
  }, events);
}

async function setAssist(patch: { status?: Status; askReason?: string | null }): Promise<void> {
  await electronApp.evaluate((_main, p) => {
    const g = globalThis as unknown as { __sbAssistLogin: Record<string, unknown> };
    Object.assign(g.__sbAssistLogin, p);
  }, patch);
}

async function assistLog(): Promise<{ asked: number; tokenSaves: number; clears: number }> {
  return electronApp.evaluate(() => {
    const g = globalThis as unknown as { __sbAssistLogin: { asked: number; tokenSaves: number; clears: number } };
    return { asked: g.__sbAssistLogin.asked, tokenSaves: g.__sbAssistLogin.tokenSaves, clears: g.__sbAssistLogin.clears };
  });
}

async function shot(name: string): Promise<void> {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await window.screenshot({ path: path.join(SHOTS_DIR, name) });
}

async function fitsInViewport(selector: string): Promise<boolean> {
  return window.locator(selector).first().evaluate((el, size) => {
    const box = el.getBoundingClientRect();
    const unclipped = el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
    return unclipped && box.left >= 0 && box.top >= 0 && box.right <= size.width && box.bottom <= size.height;
  }, { width: WIDTH, height: HEIGHT });
}

async function expectNoTokenField(): Promise<void> {
  await expect(window.locator('#mixer-cloud-token')).toHaveCount(0);
  await expect(window.locator('#mixer-assist-settings input[type="password"]')).toHaveCount(0);
  const text = await window.locator('#mixer-assist-settings').innerText();
  for (const phrase of TOKEN_COPY) expect(text).not.toContain(phrase);
}

async function openConsoleSettings(): Promise<void> {
  await window.locator('#settings-btn').click();
  await window.locator('#settings-tab-btn-console').click();
  await expect(window.locator('#mixer-assist-settings')).toBeVisible();
}

async function closeSettings(): Promise<void> {
  await window.locator('#settings-dialog-done').click();
  await expect(window.locator('#settings-dialog')).toBeHidden();
}

async function reopenMixer(): Promise<void> {
  await window.locator('.mode-tab[data-mode="console"]').click();
  await window.locator('.mode-tab[data-mode="mixer"]').click();
  await expect(window.locator('#mixer-root')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Mixer assist with Claude Code login (flag mixerCloudAssistLogin, stubbed assist IPC, no real Claude, no keychain)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_FEATURES: 'console,mixer,mixerCloudAssistLogin' }));
    await withRetry(() =>
      electronApp.evaluate(({ ipcMain, BrowserWindow }, init) => {
        ipcMain.removeHandler('fetch-console-identity');
        ipcMain.handle('fetch-console-identity', () => ({ success: true, identity: { ip: init.ip, model: 'X32', firmware: '4.06', name: 'FOH' } }));
        ipcMain.removeHandler('start-console-live-state');
        ipcMain.handle('start-console-live-state', () => ({ success: true }));
        ipcMain.removeHandler('stop-console-live-state');
        ipcMain.handle('stop-console-live-state', () => ({ success: true }));

        const state = { status: init.status, askReason: null as string | null, asked: 0, tokenSaves: 0, clears: 0 };
        (globalThis as unknown as { __sbAssistLogin: typeof state }).__sbAssistLogin = state;
        ipcMain.removeHandler('get-mixer-assist-status');
        ipcMain.handle('get-mixer-assist-status', () => state.status);
        ipcMain.removeHandler('set-mixer-assist-token');
        ipcMain.handle('set-mixer-assist-token', () => {
          state.tokenSaves += 1;
          return { ok: false, reason: 'login-mode', message: 'refused', status: state.status };
        });
        ipcMain.removeHandler('clear-mixer-assist-token');
        ipcMain.handle('clear-mixer-assist-token', () => {
          state.clears += 1;
          state.status = { ...state.status, cloud: { ...state.status.cloud, storedToken: false } };
          return state.status;
        });
        ipcMain.removeHandler('ask-mixer-assist');
        ipcMain.handle('ask-mixer-assist', (_e, req: { trigger: string; issue?: { key: string } }) => {
          state.asked += 1;
          const issueKey = req.trigger === 'anomaly' ? req.issue?.key ?? null : null;
          const reason = state.askReason;
          if (reason === null) return { ok: true, trigger: req.trigger, issueKey, source: 'cloud', text: 'Lower the trim on 02.', attempts: [] };
          state.status = { ...state.status, cloud: { ...state.status.cloud, lastFailure: reason } };
          return { ok: false, trigger: req.trigger, issueKey, reason, attempts: [{ source: 'cloud', reason }] };
        });
        ipcMain.removeHandler('cancel-mixer-assist');
        ipcMain.handle('cancel-mixer-assist', () => ({ success: true }));
        BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      }, { ip: IP, status: withCloud({ enabled: false, storedToken: true }) })
    );
    await window.setViewportSize({ width: WIDTH, height: HEIGHT });
    await window.evaluate(() => (window as unknown as { rendererHydration: Promise<unknown> }).rendererHydration);
    await window.locator('.mode-tab[data-mode="console"]').click();
    await window.locator('#console-manual-ip').fill(IP);
    await window.locator('#console-manual-submit').click();
    await window.getByRole('button', { name: 'Allow read-only access' }).click();
    await expect(window.locator('#console-identity')).toContainText('X32');
    await window.locator('#console-live-toggle').click();
    await expect(window.locator('#console-live-toggle')).toHaveText('Stop watching');
    await window.locator('.mode-tab[data-mode="mixer"]').click();
    await expect(window.locator('#mixer-root')).toBeVisible();
    await push([channelsEvent(), { link: { status: 'online', metersDegraded: false } }, metersEvent()]);
    await expect(window.locator('#mixer-cards .mx-card')).toHaveCount(2);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('Settings with a token saved before: no token field, the one-time notice, and Remove stored token clears it', async () => {
    await setAssist({ status: withCloud({ storedToken: true }) });
    await openConsoleSettings();
    await window.locator('#mixer-cloud-assist-toggle').click();
    await expect(window.locator('#mixer-cloud-assist-toggle')).toBeChecked();
    await expectNoTokenField();
    await expect(window.locator('#mixer-assist-intro')).toContainText('Works with the AI you already have');
    await expect(window.locator('#mixer-cloud-login-copy')).toContainText('your own Claude Code login');
    await expect(window.locator('#mixer-cloud-stored-token-notice')).toContainText('Sound Buddy no longer stores a Claude Code token');
    await expect(window.locator('#mixer-cloud-stored-token-remove')).toHaveText('Remove stored token');
    await window.locator('#mixer-cloud-stored-token-notice').scrollIntoViewIfNeeded();
    expect(await fitsInViewport('#mixer-cloud-stored-token-notice')).toBe(true);
    await shot('settings-login-migration.png');
    await window.locator('#mixer-cloud-stored-token-remove').click();
    await expect(window.locator('#mixer-cloud-stored-token-notice')).toHaveCount(0);
    expect(await assistLog()).toMatchObject({ clears: 1, tokenSaves: 0 });
    await closeSettings();
  });

  test('Settings with Claude Code missing: an honest not-installed line, no token field', async () => {
    await setAssist({ status: withCloud({ binaryFound: false }) });
    await openConsoleSettings();
    await expectNoTokenField();
    await expect(window.locator('#mixer-assist-status-cloud')).toContainText(MISSING_LINE);
    await expect(window.locator('#mixer-assist-status-cloud')).not.toContainText(SIGNED_OUT_LINE);
    await expect(window.locator('#mixer-cloud-binary-status')).toHaveText('Claude Code not found');
    await window.locator('#mixer-assist-status').scrollIntoViewIfNeeded();
    expect(await fitsInViewport('#mixer-assist-status-cloud')).toBe(true);
    await shot('settings-login-missing.png');
    await closeSettings();
  });

  test('rail with Claude Code missing: the not-installed line, rules fallback, cards still shown', async () => {
    await reopenMixer();
    await expect(window.locator('[data-reason="cloud:no-binary"]')).toContainText(MISSING_LINE);
    await expect(window.locator('[data-reason="rules"]')).toBeVisible();
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await expect(window.locator('.mx-chip')).toHaveCount(0);
    await expect(window.locator('#mixer-cards .mx-card').first()).toBeVisible();
    expect(await fitsInViewport('[data-reason="cloud:no-binary"]')).toBe(true);
    expect((await assistLog()).asked).toBe(0);
    await shot('rail-login-missing.png');
  });

  test('rail signed out: an ask fails with not-signed-in, the rail shows its own line and falls back to rules', async () => {
    await setAssist({ status: READY, askReason: 'not-signed-in' });
    await window.locator('#mixer-assist-recheck').click();
    await expect(window.locator('.mx-composer-input')).toBeEnabled();
    await window.locator('.mx-composer-input').fill('What should I fix first?');
    await window.locator('.mx-composer-input').press('Enter');
    await expect(window.locator('[data-reason="cloud:not-signed-in"]')).toContainText(SIGNED_OUT_LINE);
    await expect(window.locator('[data-reason="cloud:no-binary"]')).toHaveCount(0);
    await expect(window.locator('[data-reason="rules"]')).toBeVisible();
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await expect(window.locator('#mixer-cards .mx-card').first()).toBeVisible();
    expect(await fitsInViewport('[data-reason="cloud:not-signed-in"]')).toBe(true);
    expect((await assistLog()).asked).toBe(1);
    await shot('rail-login-logged-out.png');
  });

  test('Settings signed out: the not-signed-in line, distinct from not-installed, no token field', async () => {
    await openConsoleSettings();
    await expectNoTokenField();
    await expect(window.locator('#mixer-assist-status-cloud')).toContainText(SIGNED_OUT_LINE);
    await expect(window.locator('#mixer-assist-status-cloud')).not.toContainText(MISSING_LINE);
    await expect(window.locator('#mixer-cloud-binary-status')).toHaveText('Claude Code found');
    await window.locator('#mixer-assist-status').scrollIntoViewIfNeeded();
    expect(await fitsInViewport('#mixer-assist-status-cloud')).toBe(true);
    await shot('settings-login-logged-out.png');
    await closeSettings();
    expect((await assistLog()).tokenSaves).toBe(0);
  });
});
