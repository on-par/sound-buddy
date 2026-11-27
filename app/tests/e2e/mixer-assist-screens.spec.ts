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
const NEW_CLIP_CHANNEL = 25;
const NEW_CLIP_LEVEL = 1.2;
const FAKE_TOKEN = 'e2e-fake-token-not-a-secret';
const ENDPOINT = 'http://127.0.0.1:8080/v1';
const MODEL = 'qwen2.5';

const scene = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'console', 'src', 'capture-2026-08-16.scn'), 'utf8');

type Status = {
  cloud: { enabled: boolean; binaryFound: boolean; tokenSaved: boolean; encryptionAvailable: boolean; lastFailure: string | null };
  local: { enabled: boolean; endpoint: string; modelSet: boolean; lastFailure: string | null };
  inFlight: boolean;
};

const OFF: Status = {
  cloud: { enabled: false, binaryFound: false, tokenSaved: false, encryptionAvailable: true, lastFailure: null },
  local: { enabled: false, endpoint: 'unset', modelSet: false, lastFailure: null },
  inFlight: false,
};
const CLOUD_READY: Status = { ...OFF, cloud: { enabled: true, binaryFound: true, tokenSaved: true, encryptionAvailable: true, lastFailure: null } };
const BOTH_ON: Status = { ...CLOUD_READY, local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: null } };

let electronApp: ElectronApplication;
let window: Page;

function channelsEvent() {
  return {
    channels: parseChannelStrips(scene).map((s) => ({ index: s.index, name: s.name, faderDb: s.fader, on: s.on, color: s.color, icon: s.icon, dynamics: s.dynamics })),
    readAt: Date.now(),
  };
}

function metersEvent(clipping: boolean, extra: Record<number, number> = {}) {
  const inputs = Array.from({ length: CHANNELS }, (_, i) => (clipping ? (extra[i + 1] ?? CLIPPING[i + 1]) : undefined) ?? 0.15);
  return { meters: { inputs, gateGainReduction: Array(CHANNELS).fill(0), dynamicsGainReduction: Array(CHANNELS).fill(0) } };
}

async function push(events: unknown[]): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, evts) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    for (const e of evts) wc.send('console-live-state', e);
  }, events);
}

async function setAssist(patch: { status?: Status; hold?: boolean }): Promise<void> {
  await electronApp.evaluate((_main, p) => {
    const g = globalThis as unknown as { __sbAssist: Record<string, unknown> };
    Object.assign(g.__sbAssist, p);
  }, patch);
}

async function assistLog(): Promise<{ asked: Array<{ trigger: string; question?: string }>; tokenLengths: number[]; cancels: number }> {
  return electronApp.evaluate(() => {
    const g = globalThis as unknown as { __sbAssist: { asked: Array<{ trigger: string; question?: string }>; tokenLengths: number[]; cancels: number } };
    return { asked: g.__sbAssist.asked, tokenLengths: g.__sbAssist.tokenLengths, cancels: g.__sbAssist.cancels };
  });
}

async function shot(name: string): Promise<void> {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await window.screenshot({ path: path.join(SHOTS_DIR, name) });
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

test.describe('Mixer assist screens (stubbed assist IPC, no real Claude, no keychain)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_FEATURES: 'console,mixer' }));
    await withRetry(() =>
      electronApp.evaluate(({ ipcMain, BrowserWindow }, init) => {
        ipcMain.removeHandler('fetch-console-identity');
        ipcMain.handle('fetch-console-identity', () => ({ success: true, identity: { ip: init.ip, model: 'X32', firmware: '4.06', name: 'FOH' } }));
        ipcMain.removeHandler('start-console-live-state');
        ipcMain.handle('start-console-live-state', () => ({ success: true }));
        ipcMain.removeHandler('stop-console-live-state');
        ipcMain.handle('stop-console-live-state', () => ({ success: true }));

        type Held = { resolve: (v: unknown) => void; trigger: string } | null;
        const state = {
          status: init.off,
          hold: false,
          held: null as Held,
          asked: [] as unknown[],
          tokenLengths: [] as number[],
          cancels: 0,
        };
        (globalThis as unknown as { __sbAssist: typeof state }).__sbAssist = state;
        const withSaved = (saved: boolean) => ({ ...state.status, cloud: { ...state.status.cloud, tokenSaved: saved } });
        ipcMain.removeHandler('get-mixer-assist-status');
        ipcMain.handle('get-mixer-assist-status', () => ({ ...state.status, inFlight: state.held !== null }));
        ipcMain.removeHandler('set-mixer-assist-token');
        ipcMain.handle('set-mixer-assist-token', (_e, token: string) => {
          state.tokenLengths.push(String(token).length);
          state.status = withSaved(true);
          return { ok: true, status: state.status };
        });
        ipcMain.removeHandler('clear-mixer-assist-token');
        ipcMain.handle('clear-mixer-assist-token', () => {
          state.status = withSaved(false);
          return state.status;
        });
        ipcMain.removeHandler('ask-mixer-assist');
        ipcMain.handle('ask-mixer-assist', (_e, req: { trigger: string; question?: string; issue?: { key: string } }) => {
          state.asked.push(req);
          const issueKey = req.trigger === 'anomaly' ? req.issue?.key ?? null : null;
          if (state.held !== null) {
            if (req.trigger === 'question' && state.held.trigger === 'question') return { ok: false, trigger: req.trigger, issueKey, reason: 'busy', attempts: [] };
          }
          if (state.hold) {
            return new Promise((resolve) => {
              state.held = { resolve, trigger: req.trigger };
            });
          }
          const text =
            req.trigger === 'anomaly'
              ? 'The preamp is overloading before the fader. Bring the trim down until the peak meter stays out of the red, then reset the fader.'
              : 'Start with 02 Vox 1: its input is clipping. Lower the trim a few dB, then check 05 MC, which is also hitting the top of its meter.';
          return { ok: true, trigger: req.trigger, issueKey, source: 'cloud', text, attempts: [] };
        });
        ipcMain.removeHandler('cancel-mixer-assist');
        ipcMain.handle('cancel-mixer-assist', () => {
          state.cancels += 1;
          const held = state.held;
          state.held = null;
          held?.resolve({ ok: false, trigger: held.trigger, issueKey: null, reason: 'cancelled', attempts: [{ source: 'cloud', reason: 'cancelled' }] });
          return { success: true };
        });
        BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      }, { ip: IP, off: OFF })
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
    await push([channelsEvent(), { link: { status: 'online', metersDegraded: false } }, metersEvent(true)]);
    await expect(window.locator('#mixer-cards .mx-card')).toHaveCount(2);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('Settings with both assists off: the section, its copy and the locked phrase', async () => {
    await openConsoleSettings();
    await expect(window.locator('#mixer-assist-intro')).toContainText('Works with the AI you already have');
    await expect(window.locator('#mixer-cloud-assist-copy')).toContainText('Audio is never sent.');
    await expect(window.locator('#mixer-cloud-assist-toggle')).not.toBeChecked();
    await expect(window.locator('#mixer-local-assist-toggle')).not.toBeChecked();
    await expect(window.locator('#mixer-cloud-token-status')).toHaveText('Not set');
    await expect(window.locator('#mixer-assist-status-cloud')).toHaveText('Cloud assist is off.');
    await window.locator('#mixer-assist-settings').scrollIntoViewIfNeeded();
    await shot('settings-assist-off.png');
    await closeSettings();
  });

  test('rail with both off: rules only, composer disabled, no chips', async () => {
    await reopenMixer();
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await expect(window.locator('.mx-composer-input')).toHaveAttribute('placeholder', 'Rules only. Turn on an assist in Settings to ask questions.');
    await expect(window.locator('.mx-chip')).toHaveCount(0);
    expect((await assistLog()).asked).toEqual([]);
    await shot('rail-rules-only.png');
  });

  test('Settings with Cloud on: the token is sent once, the field empties, status reads Token saved; Local fields fill', async () => {
    await setAssist({ status: { ...BOTH_ON, cloud: { ...BOTH_ON.cloud, tokenSaved: false } } });
    await openConsoleSettings();
    await window.locator('#mixer-cloud-assist-toggle').click();
    await expect(window.locator('#mixer-cloud-assist-toggle')).toBeChecked();
    await window.locator('#mixer-cloud-token').fill(FAKE_TOKEN);
    await window.locator('#mixer-cloud-token-save').click();
    await expect(window.locator('#mixer-cloud-token-status')).toHaveText('Token saved');
    await expect(window.locator('#mixer-cloud-token')).toHaveValue('');
    expect((await assistLog()).tokenLengths).toEqual([FAKE_TOKEN.length]);
    expect(await window.content()).not.toContain(FAKE_TOKEN);
    await window.locator('#mixer-local-assist-toggle').click();
    await window.locator('#mixer-local-endpoint').fill(ENDPOINT);
    await window.locator('#mixer-local-endpoint-save').click();
    await window.locator('#mixer-local-model').fill(MODEL);
    await window.locator('#mixer-local-model-save').click();
    await expect(window.locator('#mixer-local-endpoint')).toHaveValue(ENDPOINT);
    await expect(window.locator('#mixer-local-model')).toHaveValue(MODEL);
    await expect(window.locator('#mixer-assist-status-cloud')).toHaveText('Cloud assist is ready: Claude Code found, token saved.');
    await expect(window.locator('#mixer-assist-status-local')).toHaveText(`Local assist is ready: ${ENDPOINT}.`);
    await window.locator('#mixer-assist-status').scrollIntoViewIfNeeded();
    await shot('settings-assist-on.png');
    await closeSettings();
  });

  test('rail healthy: composer enabled, quick chips, a narrated card and an answer, each labelled with its source', async () => {
    await setAssist({ status: CLOUD_READY });
    await reopenMixer();
    await expect(window.locator('.mx-composer-input')).toBeEnabled();
    expect((await assistLog()).asked).toEqual([]);
    await push([metersEvent(true, { [NEW_CLIP_CHANNEL]: NEW_CLIP_LEVEL })]);
    await expect(window.locator('#mixer-cards .mx-card')).toHaveCount(3);
    await expect(window.locator('.mx-answer')).toHaveCount(1);
    await expect(window.locator('.mx-answer').first()).toContainText('About 25');
    await window.locator('.mx-composer-input').fill('What should I fix first?');
    await window.locator('.mx-composer-input').press('Enter');
    await expect(window.locator('.mx-answer')).toHaveCount(2);
    await expect(window.locator('.mx-answer').first()).toContainText('What should I fix first?');
    await expect(window.locator('.mx-answer-src').first()).toHaveText('Cloud · Claude Code');
    await expect(window.locator('.mx-chip')).toHaveCount(3);
    await expect(window.locator('.mx-composer-input')).toHaveValue('');
    const asked = (await assistLog()).asked;
    expect(asked.map((r) => r.trigger)).toEqual(['anomaly', 'question']);
    expect(asked[1].question).toBe('What should I fix first?');
    await expect(window.locator('.mx-apply').first()).toHaveCount(0);
    await shot('rail-healthy.png');
  });

  test('rail in flight: a pending line with Cancel, and Cancel ends it', async () => {
    await setAssist({ hold: true });
    await window.locator('.mx-chip').first().click();
    await expect(window.locator('#mixer-assist-pending')).toContainText('Asking: What needs attention first?');
    await expect(window.locator('#mixer-assist-cancel')).toBeVisible();
    await shot('rail-in-flight.png');
    await window.locator('#mixer-assist-cancel').click();
    await expect(window.locator('#mixer-assist-pending')).toHaveCount(0);
    expect((await assistLog()).cancels).toBe(1);
  });

  test('rail busy: a second question while one runs gets its own busy line', async () => {
    await window.locator('.mx-composer-input').fill('First question?');
    await window.locator('.mx-composer-input').press('Enter');
    await expect(window.locator('#mixer-assist-pending')).toBeVisible();
    await window.locator('.mx-composer-input').fill('Second question?');
    await window.locator('.mx-composer-input').press('Enter');
    await expect(window.locator('#mixer-assist-busy')).toContainText('Still answering the last question');
    await expect(window.locator('#mixer-assist-pending')).toContainText('First question?');
    await shot('rail-busy.png');
    await window.locator('#mixer-assist-cancel').click();
    await expect(window.locator('#mixer-assist-pending')).toHaveCount(0);
    await setAssist({ hold: false });
  });

  test('rail fallback: Cloud on with no Claude Code binary', async () => {
    await setAssist({ status: { ...OFF, cloud: { enabled: true, binaryFound: false, tokenSaved: true, encryptionAvailable: true, lastFailure: null } } });
    await reopenMixer();
    await expect(window.locator('[data-reason="cloud:no-binary"]')).toContainText("Claude Code isn't installed");
    await expect(window.locator('[data-reason="rules"]')).toBeVisible();
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await expect(window.locator('.mx-chip')).toHaveCount(0);
    await expect(window.locator('#mixer-cards .mx-card').first()).toBeVisible();
    await shot('rail-fallback-no-binary.png');
  });

  test('rail fallback: Cloud on with no token', async () => {
    await setAssist({ status: { ...OFF, cloud: { enabled: true, binaryFound: true, tokenSaved: false, encryptionAvailable: true, lastFailure: null } } });
    await window.locator('#mixer-assist-recheck').click();
    await expect(window.locator('[data-reason="cloud:no-token"]')).toContainText("The Claude Code token isn't set");
    await expect(window.locator('[data-reason="cloud:no-binary"]')).toHaveCount(0);
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await shot('rail-fallback-no-token.png');
  });

  test('rail fallback: Local on with the endpoint down', async () => {
    await setAssist({ status: { ...OFF, local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: 'endpoint-down' } } });
    await window.locator('#mixer-assist-recheck').click();
    await expect(window.locator('[data-reason="local:endpoint-down"]')).toContainText("The Local model server isn't answering");
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await expect(window.locator('#mixer-cards .mx-card').first()).toBeVisible();
    await shot('rail-fallback-local-down.png');
  });
});
