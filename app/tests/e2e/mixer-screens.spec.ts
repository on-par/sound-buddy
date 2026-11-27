// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parseChannelStrips, parseChannelSends, parseConsoleSurfaces } from '@sound-buddy/console/dist-cjs/index.js';
import { launchApp, withRetry } from './e2e-helpers';

const SHOTS_DIR = process.env.SB_MIXER_SHOTS_DIR;
const WIDTH = 1440;
const HEIGHT = 900;
const IP = '10.0.0.50';
const CHANNELS = 32;
const CLIPPING: Record<number, number> = { 2: 1.6, 5: 1.35, 25: 1.2, 12: 1.05 };
const SIGNAL: Record<number, number> = { 1: 0.12, 3: 0.2, 4: 0.18, 6: 0.25, 7: 0.3, 8: 0.3, 9: 0.22, 10: 0.22, 11: 0.15, 16: 0.08, 26: 0.4, 29: 0.2 };
const RING_INDEX = 36;
const ANALYZER_POINTS = 48;

const scene = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'console', 'src', 'capture-2026-08-16.scn'), 'utf8');

let electronApp: ElectronApplication;
let window: Page;

function channelsEvent(ratioOverride: Record<number, number> = {}) {
  return {
    channels: parseChannelStrips(scene).map((s) => ({
      index: s.index, name: s.name, faderDb: s.fader, on: s.on, color: s.color, icon: s.icon,
      dynamics: ratioOverride[s.index] === undefined ? s.dynamics : { ...s.dynamics, ratio: ratioOverride[s.index] },
    })),
    readAt: Date.now(),
  };
}

function stripDetailNotReadFor(channel: number) {
  const [{ stripDetail }] = slowTierEvents() as [{ stripDetail: Array<{ index: number }> }];
  return { stripDetail: stripDetail.map((d) => (d.index === channel ? { index: channel, preamp: null, gate: null, eq: null, sends: null } : d)) };
}

const MOVE_KEY = 'over-compression:1:comp-ratio';

async function injectMove(ratio: number): Promise<void> {
  await window.evaluate(([key, from]) => {
    const stores = (window as unknown as { rendererStores: { mixer: { setState(s: object): void } } }).rendererStores;
    stores.mixer.setState({
      moves: {
        [key]: {
          key, issueKey: 'over-compression:1', channel: 1, parameter: 'comp-ratio',
          from, to: 4,
          why: 'The compressor has been holding heavy gain reduction. One ratio step gentler lets loud passages through with less squeeze.',
          expected: 'Less gain reduction on loud passages; the channel should sound less squashed.',
          status: 'pending',
        },
      },
    });
  }, [MOVE_KEY, ratio] as const);
}

async function clearMoves(): Promise<void> {
  await window.evaluate(() => {
    (window as unknown as { rendererStores: { mixer: { setState(s: object): void } } }).rendererStores.mixer.setState({ moves: {}, dismissedMoves: [] });
  });
}

function slowTierEvents() {
  const now = Date.now();
  const strips = parseChannelStrips(scene);
  const sends = parseChannelSends(scene);
  const surfaces = parseConsoleSurfaces(scene);
  const stripDetail = strips.map((s) => ({
    index: s.index,
    preamp: { value: s.preamp, readAt: now - 4000 },
    gate: { value: s.gate, readAt: now - 4000 },
    eq: { value: s.eq, readAt: now - 6000 },
    sends: { value: sends.filter((x) => x.channel === s.index).map((x) => ({ bus: x.bus, on: x.on, level: x.level })), readAt: now - 21_000 },
  }));
  const main = surfaces.mains.find((m) => m.id === 'st');
  return [
    { stripDetail },
    {
      surfaces: {
        buses: surfaces.buses.map((b) => ({
          kind: 'bus', index: b.index, name: { value: b.name, readAt: now - 3000 }, mix: { value: { on: b.on, faderDb: b.fader }, readAt: now - 3000 },
        })),
        main: { kind: 'main', index: null, name: { value: main?.name ?? '', readAt: now - 5000 }, mix: { value: { on: main?.on ?? true, faderDb: main?.fader ?? 0 }, readAt: now - 5000 } },
      },
    },
  ];
}

function metersEvent(clipping: boolean) {
  const inputs = Array.from({ length: CHANNELS }, (_, i) => (clipping ? CLIPPING[i + 1] : undefined) ?? SIGNAL[i + 1] ?? 0.01);
  return { meters: { inputs, gateGainReduction: Array(CHANNELS).fill(0), dynamicsGainReduction: Array(CHANNELS).fill(0) } };
}

async function push(events: unknown[]): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, evts) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    for (const e of evts) wc.send('console-live-state', e);
  }, events);
}

async function pushRoomRing(): Promise<void> {
  const curve = Array.from({ length: ANALYZER_POINTS }, (_, i) => -52 - Math.abs(i - 20) * 0.4 + (i === RING_INDEX ? 18 : 0));
  await electronApp.evaluate(({ BrowserWindow }, c) => {
    BrowserWindow.getAllWindows()[0].webContents.send('measurement-event', {
      type: 'meter',
      ts: Date.now(),
      channels: [{ index: 0, name: 'Room', bands: {}, curve: c, rms: -30, peak: -12, clipping: false, centroid: 1200, rolloff: 5000 }],
    });
  }, curve);
}

async function shot(name: string): Promise<void> {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await window.screenshot({ path: path.join(SHOTS_DIR, name) });
}

test.describe.configure({ mode: 'serial' });

test.describe('Mixer screens (read-only, fixture-fed)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_FEATURES: 'console,mixer' }));
    await withRetry(() =>
      electronApp.evaluate(({ ipcMain, BrowserWindow }, ip) => {
        ipcMain.removeHandler('fetch-console-identity');
        ipcMain.handle('fetch-console-identity', () => ({ success: true, identity: { ip, model: 'X32', firmware: '4.06', name: 'FOH' } }));
        ipcMain.removeHandler('start-console-live-state');
        ipcMain.handle('start-console-live-state', () => ({ success: true }));
        ipcMain.removeHandler('stop-console-live-state');
        ipcMain.handle('stop-console-live-state', () => ({ success: true }));
        BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      }, IP)
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
    await push([channelsEvent(), ...slowTierEvents(), { link: { status: 'online', metersDegraded: false } }, metersEvent(false)]);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('the Mixer tab sits after Console with a NEW badge', async () => {
    await expect(window.locator('.mode-tab[data-mode="mixer"] .tab-new')).toHaveText('NEW');
  });

  test('calm: no urgent issues detected, with the running checks, board and routing', async () => {
    await expect(window.locator('#mixer-calm')).toContainText('No urgent issues detected');
    await expect(window.locator('#mixer-calm')).toContainText('Over-compression: off until the GR meter scale is established');
    await expect(window.locator('#mixer-conn')).toHaveText('Connected: X32 · 32 ch');
    await expect(window.locator('#mixer-routing')).toBeVisible();
    await expect(window.locator('#mixer-routing .mx-route-age').first()).toHaveText(/^read \d+ s ago$/);
    await shot('calm.png');
  });

  test('meters degraded: meter checks pause, the notice explains it, /node state keeps showing', async () => {
    await push([{ link: { status: 'online', metersDegraded: true } }]);
    await expect(window.locator('#mixer-link-notice')).toHaveText(
      'Meters unavailable. Meter checks are paused; channel state is still being read from the console.'
    );
    await expect(window.locator('#mixer-calm')).toContainText('Clipping: paused while console meters are unavailable');
    await expect(window.locator('#mixer-rail-context')).toContainText('input meters unavailable');
    await expect(window.locator('#mixer-conn')).toHaveText('Connected: X32 · 32 ch');
    await shot('meters-degraded.png');
    await push([{ link: { status: 'online', metersDegraded: false } }, metersEvent(false)]);
    await expect(window.locator('#mixer-link-notice')).toHaveCount(0);
  });

  test('Buses view: every bus with its number, fader, visible read age and the channels sending to it', async () => {
    await window.locator('[data-view="buses"]').click();
    await expect(window.locator('#mixer-buses')).toBeVisible();
    await expect(window.locator('#mixer-buses .mx-bus-row')).toHaveCount(16);
    await expect(window.locator('#mixer-buses .mx-bus-row[data-bus="1"] .mx-bus-name')).toHaveText(/^Bus 1/);
    await expect(window.locator('#mixer-buses .mx-bus-row[data-bus="1"] .mx-bus-age')).toHaveText(/^read \d+ s ago$/);
    await shot('buses-view.png');
    await window.locator('[data-view="attention"]').click();
  });

  test('attention: three cards ranked by severity and a +1 queued pill', async () => {
    await push([metersEvent(true), channelsEvent()]);
    await expect(window.locator('#mixer-cards .mx-card')).toHaveCount(3);
    await expect(window.locator('#mixer-queued')).toContainText('+1 queued');
    await expect(window.locator('.mx-sec-sub')).toContainText('ranked by severity');
    await expect(window.locator('#mixer-cards')).toContainText('GR unavailable');
    await expect(window.locator('#mixer-cards')).toContainText('Share of mix unavailable');
    await expect(window.locator('#mixer-dock .mx-bus').first()).toContainText(/^Bus 1 · /);
    await expect(window.locator('#mixer-dock .mx-bus-age').first()).toHaveText(/^read \d+ s ago$/);
    await shot('attention.png');
  });

  test('inspector: every no-source panel shows its unavailable state and no curve', async () => {
    await window.locator('[data-view="all"]').click();
    await window.locator('.mx-board-grid [data-channel="2"]').click();
    await expect(window.locator('#mixer-spectrum-unavailable')).toContainText('Channel spectrum unavailable');
    await expect(window.locator('#mixer-masking-unavailable')).toBeVisible();
    await expect(window.locator('#mixer-share-unavailable')).toBeVisible();
    await expect(window.locator('#mixer-inspector svg')).toHaveCount(0);
    await expect(window.locator('#mixer-inspector .mx-step')).toHaveCount(7);
    await expect(window.locator('#mixer-inspector .mx-step', { hasText: 'Sends' }).locator('.mx-step-age')).toHaveText(/^read \d+ s ago$/);
    await expect(window.locator('#mixer-inspector .mx-step', { hasText: 'Master' })).toContainText(/Main LR -?\d/);
    await shot('inspector-unavailable.png');
    await window.locator('[data-view="attention"]').click();
  });

  test('a strip before its slow-tier read: every slow value says Not read yet, and sends say Sends not read yet', async () => {
    await push([stripDetailNotReadFor(30)]);
    await window.locator('[data-view="all"]').click();
    await window.locator('.mx-board-grid [data-channel="30"]').click();
    const chain = window.locator('#mixer-inspector .mx-chain');
    await expect(chain.locator('.mx-step-unread')).toHaveCount(5);
    await expect(chain.locator('.mx-step', { hasText: 'Trim' })).toContainText('Not read yet');
    await expect(chain.locator('.mx-step', { hasText: 'Sends' })).toContainText('Sends not read yet');
    await shot('not-read-yet.png');
    await push([slowTierEvents()[0]]);
    await window.locator('[data-view="attention"]').click();
  });

  test('locked Apply with the moved channel inspected: Apply disabled, and the dashed proposed row on that channel', async () => {
    await push([metersEvent(true)]);
    const dyn = parseChannelStrips(scene)[0].dynamics;
    await injectMove(dyn.ratio);
    await window.locator('#mixer-dock [data-channel="1"]').click();
    await expect(window.locator('#mixer-inspector .mx-scrib').first()).toContainText('01');
    await expect(window.locator('#mixer-inspector .mx-step-proposed')).toContainText('Comp ratio 5.0:1 → 4.0:1');
    await expect(window.locator('#mixer-inspector .mx-chain-h')).toContainText('1 proposed');
    await expect(window.locator('.mx-apply')).toBeDisabled();
    await expect(window.locator('.mx-undo')).toBeDisabled();
    await expect(window.locator('.mx-locked')).toHaveText('Console writes are locked in this build');
    await expect(window.locator('.mx-composer-input')).toBeDisabled();
    await shot('locked-apply.png');
    await shot('dashed-proposed-row.png');
  });

  test('changed on desk: the desk moves the same value, so the pending move resolves as changed on desk', async () => {
    await push([channelsEvent({ 1: 4 })]);
    await expect(window.locator(`[data-move-key="${MOVE_KEY}"]`)).toContainText('Changed on desk');
    await expect(window.locator(`[data-move-key="${MOVE_KEY}"]`)).toHaveClass(/mx-move-done/);
    await expect(window.locator('#mixer-inspector .mx-step-proposed')).toHaveCount(0);
    await shot('changed-on-desk.png');
    await clearMoves();
    await push([channelsEvent()]);
    await expect(window.locator(`[data-move-key="${MOVE_KEY}"]`)).toHaveCount(0);
  });

  test('Sermon Quiet with no room spectrum: the feedback watch is unavailable', async () => {
    await push([metersEvent(true)]);
    await window.locator('#mixer-sermon-quiet').click();
    await window.locator('.mx-board-grid [data-channel="5"]').click();
    await expect(window.locator('#mixer-sermon-banner')).toContainText('feedback watch unavailable — room mic is not listening');
    await expect(window.locator('.mx-board-grid [data-channel="5"]')).toHaveClass(/mx-tile-watch/);
    await expect(window.locator('#mixer-rail-sermon')).toContainText('Only feedback risk will interrupt');
    await shot('sermon-quiet-unavailable.png');
  });

  test('Sermon Quiet with the room mic listening: feedback watch only, one room ring card', async () => {
    await window.evaluate(() => {
      const stores = (window as unknown as { rendererStores: { liveCapture: { setState(s: object): void } } }).rendererStores;
      stores.liveCapture.setState({ secondaryMeasurement: { status: 'active', deviceName: 'Room mic' } });
    });
    for (let i = 0; i < 9; i++) {
      await pushRoomRing();
      await push([metersEvent(true)]);
      await window.waitForTimeout(500);
    }
    await expect(window.locator('#mixer-sermon-banner')).toContainText('Sermon Quiet active — feedback watch only');
    await expect(window.locator('[data-card-key="feedback-risk:room"]')).toContainText('Room ring near');
    await expect(window.locator('#mixer-cards .mx-card')).toHaveCount(1);
    await shot('sermon-quiet-live.png');
  });

  test('inspector with the room mic listening: the RTA is labelled as the whole room, not the channel', async () => {
    await window.locator('#mixer-sermon-quiet').click();
    await window.locator('[data-view="all"]').click();
    await window.locator('.mx-board-grid [data-channel="2"]').click();
    await expect(window.locator('#mixer-room-rta .mx-canvas-label')).toHaveText('Room mic RTA — the whole room, not this channel');
    await expect(window.locator('#mixer-room-rta svg path')).toHaveCount(1);
    await expect(window.locator('#mixer-spectrum-unavailable')).toHaveCount(0);
    await shot('inspector-room-rta.png');
    await window.locator('[data-view="attention"]').click();
  });

  test('disconnected: red chip, Reconnect, frozen cards, no live Comp and no input meters in the rail', async () => {
    await window.evaluate(() => {
      const stores = (window as unknown as { rendererStores: { liveCapture: { setState(s: object): void } } }).rendererStores;
      stores.liveCapture.setState({ secondaryMeasurement: { status: 'off', deviceName: '' }, lastMeasurementChannels: null });
    });
    await push([metersEvent(true)]);
    await push([{ link: { status: 'offline', metersDegraded: false } }]);
    await expect(window.locator('#mixer-conn')).toHaveClass(/mx-conn-offline/);
    await expect(window.locator('#mixer-reconnect')).toBeVisible();
    await expect(window.locator('#mixer-link-notice')).toContainText('Cards are frozen');
    await expect(window.locator('.mx-card-dismiss').first()).toBeDisabled();
    await expect(window.locator('#mixer-rail-context')).toContainText('X32 offline');
    await expect(window.locator('#mixer-rail-context')).not.toContainText('input meters');
    await expect(window.locator('#mixer-inspector .mx-step-age', { hasText: /^live$/ })).toHaveCount(0);
    await expect(window.locator('#mixer-inspector .mx-step', { hasText: 'Comp' }).first().locator('.mx-step-age')).toHaveText(/^read \d+ s ago$/);
    await shot('disconnected.png');
    await shot('reconnect-before.png');
  });

  test('Reconnect: clicking it restarts the read and the cards unfreeze', async () => {
    await window.locator('#mixer-reconnect').click();
    await expect(window.locator('#mixer-link-notice')).toHaveCount(0);
    await expect(window.locator('#mixer-reconnect')).toHaveCount(0);
    await push([{ link: { status: 'online', metersDegraded: false } }, metersEvent(true), channelsEvent()]);
    await expect(window.locator('#mixer-conn')).toHaveText('Connected: X32 · 32 ch');
    await expect(window.locator('#mixer-cards .mx-card')).toHaveCount(3);
    await expect(window.locator('.mx-card-dismiss').first()).toBeEnabled();
    await expect(window.locator('#mixer-inspector .mx-step', { hasText: 'Comp' }).first().locator('.mx-step-age')).toHaveText('live');
    await expect(window.locator('#mixer-rail-context')).toContainText('input meters');
    await shot('reconnect-after.png');
  });
});
