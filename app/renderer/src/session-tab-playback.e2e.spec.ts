import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from '../../tests/e2e/e2e-helpers';

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'session');

async function enableDawWorkspace(win: Page): Promise<void> {
  await win.locator('#settings-btn').click();
  await win.locator('#settings-tab-btn-labs').click();
  await win.locator('#daw-workspace-toggle').check();
  await win.locator('#settings-dialog-done').click();
}

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
      ipcMain.removeHandler('list-output-devices');
      ipcMain.handle('list-output-devices', () => ({ devices: [{ index: 1, name: 'MOTU 8ch', channels: 8 }] }));
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
      ipcMain.removeHandler('generate-session-peaks');
      ipcMain.handle('generate-session-peaks', () => ({ success: true, cached: false, peaks: { bucketsPerSecond: 50, tracks: [] } }));
      ipcMain.removeHandler('start-playback');
      ipcMain.handle('start-playback', (_event, opts) => {
        (globalThis as Record<string, unknown>).__sessionPlayback = opts;
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
    await enableDawWorkspace(window);
    await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
    await expect(window.locator('#daw-session-play')).toBeEnabled();
  });

  test('plays the selected Session take, patches its timeline, hot-swaps routes, and stops', async () => {
    // Output routing remains owned by the shared soundcheck store. Select the
    // existing Playback & listen device before returning to the Session shell.
    await window.locator('.mode-tab[data-mode="soundcheck"]').click();
    await window.locator('#sc-device-select').selectOption({ label: 'MOTU 8ch (8ch)' });
    await window.locator('.mode-tab[data-mode="live"]').click();

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

    await window.locator('.mode-tab[data-mode="soundcheck"]').click();
    await window.locator('#sc-tracks .sc-track').first().locator('.sc-route').selectOption('1');
    const routes = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionRoutes,
    )) as { route?: string };
    expect(routes.route).toBe('0:1,1:1-2');
    await window.locator('.mode-tab[data-mode="live"]').click();
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

  test('session-tab-playback-monitoring keeps the live meter updating during take playback', async () => {
    await window.locator('#record-button').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
    await window.locator('#record-button').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('LIVE');

    await window.locator('.mode-tab[data-mode="soundcheck"]').click();
    await window.locator('#sc-device-select').selectOption({ label: 'MOTU 8ch (8ch)' });
    await window.locator('.mode-tab[data-mode="live"]').click();
    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');

    await sendLiveEvent({ type: 'meter', channels: [{ rms: -18, peak: -6 }] });
    await expect(window.locator('#live-level-rms')).toHaveText('-18.0');
    await sendLiveEvent({ type: 'meter', channels: [{ rms: -12, peak: -3 }] });
    await expect(window.locator('#live-level-rms')).toHaveText('-12.0');
  });
});
