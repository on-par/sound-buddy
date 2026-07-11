import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp } from './e2e-helpers';

// Virtual Soundcheck (#46) — split out of e2e.spec.ts as its own file (#225).
// Own beforeEach stubs (list-output-devices/open-dir-dialog/start-playback/
// stop-playback) plus a reload, independent of the other describes.

let electronApp: ElectronApplication;
let window: Page;

test.describe('Virtual Soundcheck (#46)', () => {
  const SESSION_DIR = path.join(__dirname, '..', 'fixtures', 'session');

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test.beforeEach(async () => {
    await electronApp.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('list-output-devices');
      ipcMain.handle('list-output-devices', () => ({ devices: [
        { index: 0, name: 'Stereo Out', channels: 2 },
        { index: 1, name: 'MOTU 8ch', channels: 8 },
      ] }));
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => dir);
      // read-session is NOT stubbed — it reads the committed fixture session.json.
      ipcMain.removeHandler('start-playback');
      ipcMain.handle('start-playback', (_e, opts) => {
        (globalThis as Record<string, unknown>).__pb = opts; return { success: true };
      });
      ipcMain.removeHandler('stop-playback');
      ipcMain.handle('stop-playback', () => ({ success: true }));
    }, SESSION_DIR);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('.mode-tab[data-mode="soundcheck"]').click();
  });

  async function sendPlaybackEvent(data: unknown) {
    await electronApp.evaluate(({ BrowserWindow }, d) => {
      BrowserWindow.getAllWindows()[0].webContents.send('playback-event', d);
    }, data);
  }

  test('Play is disabled until a session is loaded', async () => {
    await expect(window.locator('#sc-play-btn')).toBeDisabled();
    await window.locator('#sc-choose-btn').click();
    await expect(window.locator('#sc-play-btn')).toBeEnabled();
  });

  test('loads a session and lists tracks with labels, badges, routing', async () => {
    await window.locator('#sc-choose-btn').click();
    const tracks = window.locator('#sc-tracks .sc-track');
    await expect(tracks).toHaveCount(2);
    await expect(tracks.nth(0).locator('.sc-track-name')).toHaveText('Kick');
    await expect(tracks.nth(0).locator('.sc-badge')).toHaveText('Mono');
    await expect(tracks.nth(1).locator('.sc-track-name')).toHaveText('OH');
    await expect(tracks.nth(1).locator('.sc-badge')).toHaveText('Stereo');
    await expect(tracks.nth(0).locator('.sc-route')).toBeVisible();
  });

  test('routes on a big device, plays, updates transport + meters, stops', async () => {
    await window.locator('#sc-choose-btn').click();
    await window.locator('#sc-device-select').selectOption({ label: 'MOTU 8ch (8ch)' });
    await expect(window.locator('#sc-mixdown-notice')).toBeHidden();

    await window.locator('#sc-play-btn').click();
    await expect(window.locator('#sc-stop-btn')).toBeVisible();
    const opts = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__pb,
    )) as { route?: string; sessionDir?: string };
    expect(opts.route).toBeTruthy();
    expect(opts.sessionDir).toContain('session');

    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('#sc-elapsed')).toContainText('0:02 / 0:10');
    await sendPlaybackEvent({ type: 'level', tracks: [
      { label: 'Kick', rms: -12, peak: -6, clipping: false },
      { label: 'OH', rms: -20, peak: -9, clipping: true },
    ] });
    const meters = window.locator('#spectrum-body .sc-meter');
    await expect(meters).toHaveCount(2);
    await expect(meters.nth(1)).toHaveClass(/clip/);

    await window.locator('#sc-stop-btn').click();
    await expect(window.locator('#sc-play-btn')).toBeVisible();
    await expect(window.locator('#sc-elapsed')).toBeHidden();
  });

  test('a too-small device shows the stereo-mixdown fallback notice', async () => {
    await window.locator('#sc-choose-btn').click();
    await window.locator('#sc-device-select').selectOption({ label: 'Stereo Out (2ch)' });
    await expect(window.locator('#sc-mixdown-notice')).toBeVisible();
    await expect(window.locator('#sc-mixdown-notice')).toContainText('stereo master');
    await window.locator('#sc-play-btn').click();
    await expect(window.locator('#sc-stop-btn')).toBeVisible();
    await window.locator('#sc-stop-btn').click();
  });

  test('an ended event resets the transport', async () => {
    await window.locator('#sc-choose-btn').click();
    await window.locator('#sc-play-btn').click();
    await expect(window.locator('#sc-stop-btn')).toBeVisible();
    await sendPlaybackEvent({ type: 'ended' });
    await expect(window.locator('#sc-play-btn')).toBeVisible();
    await expect(window.locator('#sc-stop-btn')).toBeHidden();
  });
});
