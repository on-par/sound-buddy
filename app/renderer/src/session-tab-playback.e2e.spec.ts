import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from '../../tests/e2e/e2e-helpers';

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'session');
const ROUTING_DRAWER_WIDTH_TOLERANCE_PX = 1;

async function sendPlaybackEvent(data: unknown): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0].webContents.send('playback-event', event);
  }, data);
}

async function sendLiveEvent(data: unknown): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0].webContents.send('live-event', event);
  }, data);
}

test.describe('Session tab playback (#1080)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await electronApp.evaluate(({ ipcMain }, dir) => {
      (globalThis as Record<string, unknown>).__sessionPlaybackCalls = [];
      ipcMain.removeHandler('list-output-devices');
      ipcMain.handle('list-output-devices', () => ({ devices: [{ index: 1, name: 'MOTU 8ch', channels: 8 }] }));
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
      ipcMain.removeHandler('generate-session-peaks');
      ipcMain.handle('generate-session-peaks', () => ({ success: true, cached: false, peaks: { bucketsPerSecond: 50, tracks: [] } }));
      ipcMain.removeHandler('start-playback');
      ipcMain.handle('start-playback', (_event, opts) => {
        (globalThis as Record<string, unknown>).__sessionPlayback = opts;
        const calls = ((globalThis as Record<string, unknown>).__sessionPlaybackCalls ??= []) as unknown[];
        calls.push(opts);
        return { success: true };
      });
      ipcMain.removeHandler('stop-playback');
      ipcMain.handle('stop-playback', () => {
        (globalThis as Record<string, unknown>).__sessionPlaybackStopped = true;
        return { success: true };
      });
      ipcMain.removeHandler('set-playback-routes');
      ipcMain.handle('set-playback-routes', (_event, opts) => {
        (globalThis as Record<string, unknown>).__sessionRoutes = opts;
        return { success: true };
      });
    }, SESSION_DIR);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await stopCaptureIfRunning(window);
    await window.locator('.mode-tab[data-mode="live"]').click();
    await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
    await expect(window.locator('#daw-session-play')).toBeEnabled();
  });

  test('plays the selected Session take, patches its timeline, hot-swaps routes, and stops', async () => {
    await window.locator('#daw-session-routing-toggle').click();
    await window.locator('#daw-session-output-device').selectOption({ label: 'MOTU 8ch (8ch)' });

    await window.locator('#daw-session-play').click();
    await expect(window.locator('#daw-session-stop')).toBeVisible();
    const start = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlayback,
    )) as { device?: string; route?: string; sessionDir?: string };
    expect(start.device).toBe('1');
    expect(start.route).toBeTruthy();
    expect(start.sessionDir).toContain('session');

    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '224px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '224px');

    await window.locator('.daw-routing-output-cell[data-routing-track-index="0"][data-routing-channels="1"]').click();
    const routes = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionRoutes,
    )) as { route?: string };
    expect(routes.route).toBe('0:1,1:1-2');
    await expect(window.locator('#daw-session-stop')).toBeVisible();

    await window.locator('#daw-session-stop').click();
    await expect(window.locator('#daw-session-play')).toBeEnabled();
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');
    expect(await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackStopped,
    )).toBe(true);

    await window.locator('#daw-session-play').click();
    const resumedStart = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlayback,
    )) as { startOffsetSecs?: number };
    expect(resumedStart.startOffsetSecs).toBe(2);

    await window.locator('#daw-session-loop').click();
    await expect(window.locator('#daw-session-loop')).toHaveAttribute('aria-pressed', 'true');

    await window.locator('#daw-session-return').click();
    const returnedStart = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlayback,
    )) as { startOffsetSecs?: number };
    expect(returnedStart.startOffsetSecs).toBe(0);

    await window.locator('#daw-session-stop').click();
    await window.locator('#daw-session-return').click();
    await expect(window.locator('.daw-transport-time')).toHaveText('0:00');

    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 3, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:03');
    await sendPlaybackEvent({ type: 'ended' });
    await expect(window.locator('#daw-session-play')).toBeVisible();
    await expect(window.locator('.daw-transport-time')).toHaveText('0:03');
  });

  test('routing-mid-playback', async () => {
    await window.locator('#daw-session-routing-toggle').click();
    await window.locator('#daw-session-output-device').selectOption({ label: 'MOTU 8ch (8ch)' });
    await window.locator('#daw-session-play').click();
    await expect(window.locator('#daw-session-stop')).toBeVisible();

    const source = window.locator('.daw-routing-source').first();
    await source.selectOption('1');
    await expect(source).toHaveValue('1');

    await window.locator('.daw-routing-output-cell[data-routing-track-index="0"][data-routing-channels="2"]').click();
    await expect(source).toHaveValue('1');
    await expect.poll(() => electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionRoutes,
    )).toEqual({ route: '0:2,1:1-2' });

    await sendPlaybackEvent({ type: 'progress', elapsed: 3, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:03');
    await expect(window.locator('#daw-session-stop')).toBeEnabled();
    expect(await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackCalls,
    )).toHaveLength(1);
    expect(await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackStopped,
    )).not.toBe(true);
  });

  test('opens, closes, and reopens the local Session routing drawer without hiding the timeline (#1089)', async () => {
    const shell = window.locator('.daw-shell');
    const routingToggle = window.locator('#daw-session-routing-toggle');
    const drawer = window.locator('#daw-session-routing-drawer');
    const arrangement = window.locator('.daw-arrangement');

    await expect(routingToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeHidden();

    await routingToggle.click();
    await expect(routingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer).toBeVisible();
    await expect(arrangement).toBeVisible();
    const drawerBox = (await drawer.boundingBox())!;
    const shellBox = (await shell.boundingBox())!;
    const arrangementBox = (await arrangement.boundingBox())!;
    expect(Math.abs(drawerBox.width - shellBox.width))
      .toBeLessThanOrEqual(ROUTING_DRAWER_WIDTH_TOLERANCE_PX);
    expect(arrangementBox.y + arrangementBox.height)
      .toBeLessThanOrEqual(drawerBox.y + ROUTING_DRAWER_WIDTH_TOLERANCE_PX);

    await routingToggle.click();
    await expect(drawer).toBeHidden();

    await routingToggle.click();
    await expect(drawer).toBeVisible();
  });

  test('scrubs active Session playback from the ruler and lanes only on pointer release (#1082)', async () => {
    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');

    const startCalls = async (): Promise<{ startOffsetSecs?: number }[]> => electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackCalls,
    ) as Promise<{ startOffsetSecs?: number }[]>;
    expect(await startCalls()).toHaveLength(1);

    const ruler = window.locator('.daw-ruler');
    const rulerBox = await ruler.boundingBox();
    expect(rulerBox).not.toBeNull();
    await window.mouse.move(rulerBox!.x, rulerBox!.y + rulerBox!.height / 2);
    await window.mouse.down();
    await window.mouse.move(rulerBox!.x + 32, rulerBox!.y + rulerBox!.height / 2);
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '240px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '240px');
    expect(await startCalls()).toHaveLength(1);
    await window.mouse.up();
    await expect.poll(startCalls).toHaveLength(2);
    expect((await startCalls())[1].startOffsetSecs).toBe(4);
    await expect(window.locator('.daw-transport-time')).toHaveText('0:04');

    await sendPlaybackEvent({ type: 'progress', elapsed: 4, duration: 10 });
    const lane = window.locator('.daw-lane').first();
    const laneBox = await lane.boundingBox();
    expect(laneBox).not.toBeNull();
    await window.mouse.move(laneBox!.x, laneBox!.y + laneBox!.height / 2);
    await window.mouse.down();
    await window.mouse.move(laneBox!.x + 48, laneBox!.y + laneBox!.height / 2);
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '256px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '256px');
    expect(await startCalls()).toHaveLength(2);
    await window.mouse.up();
    await expect.poll(startCalls).toHaveLength(3);
    expect((await startCalls())[2].startOffsetSecs).toBe(6);
    await expect(window.locator('.daw-transport-time')).toHaveText('0:06');
  });

  test('cancelling a Session scrub clears it without seeking on a later pointer release (#1082)', async () => {
    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });

    const startCalls = async (): Promise<{ startOffsetSecs?: number }[]> => electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackCalls,
    ) as Promise<{ startOffsetSecs?: number }[]>;
    expect(await startCalls()).toHaveLength(1);

    const ruler = window.locator('.daw-ruler');
    const rulerBox = await ruler.boundingBox();
    expect(rulerBox).not.toBeNull();
    await window.mouse.move(rulerBox!.x, rulerBox!.y + rulerBox!.height / 2);
    await window.mouse.down();
    await window.evaluate(() => document.defaultView!.dispatchEvent(new PointerEvent('pointercancel', {
      pointerId: 1,
    })));
    await window.evaluate(({ x, y }) => document.defaultView!.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 2,
      clientX: x,
      clientY: y,
    })), {
      x: rulerBox!.x + 32,
      y: rulerBox!.y + rulerBox!.height / 2,
    });
    await expect.poll(startCalls).toHaveLength(1);
  });

  test('session-tab-playback-monitoring keeps the live meter updating during take playback', async () => {
    await window.locator('#record-button').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
    await window.locator('#record-button').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('LIVE');

    await window.locator('#daw-session-routing-toggle').click();
    await window.locator('#daw-session-output-device').selectOption({ label: 'MOTU 8ch (8ch)' });
    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');

    await sendLiveEvent({ type: 'meter', channels: [{ rms: -18, peak: -6 }] });
    await expect(window.locator('#live-level-rms')).toHaveText('-18.0');
    await sendLiveEvent({ type: 'meter', channels: [{ rms: -12, peak: -3 }] });
    await expect(window.locator('#live-level-rms')).toHaveText('-12.0');
  });

  test('Session Record and the persistent header share capture state across tabs (#1081)', async () => {
    const sessionRecord = window.locator('#daw-session-record');
    await expect(sessionRecord).toBeEnabled();
    await sessionRecord.click();
    await expect(window.locator('#record-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(sessionRecord).toHaveAttribute('aria-pressed', 'true');
    await expect(sessionRecord).toHaveText('Stop');

    await window.locator('.mode-tab[data-mode="dir"]').click();
    const headerStop = window.locator('#record-button');
    await expect(headerStop).toBeVisible();
    await expect(headerStop).toHaveAttribute('aria-pressed', 'true');
    await headerStop.click();

    await window.locator('.mode-tab[data-mode="live"]').click();
    await expect(sessionRecord).toBeEnabled();
    await expect(sessionRecord).toHaveAttribute('aria-pressed', 'false');
    await expect(sessionRecord).toHaveText('Record');
  });

  test('Session Record uses the existing blocked-start arm hint (#1081)', async () => {
    const arms = window.locator('.daw-track-head-arm');
    for (const arm of await arms.all()) await arm.click();
    await expect(arms.first()).toHaveAttribute('aria-pressed', 'false');

    await window.locator('#daw-session-record').click();
    await expect(window.locator('#arm-hint')).toBeVisible();
    await expect(window.locator('#arm-hint')).toContainText('Arm at least one strip');
    await expect(window.locator('#daw-session-record')).toHaveAttribute('aria-pressed', 'false');
  });
});
