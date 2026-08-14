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
      // generate-session-peaks IS stubbed (#735): the real handler spawns
      // waveform_peaks.py, which needs numpy/soundfile on python3 — absent on
      // the CI runner (and #734's contract is silent failure), so the real
      // path would make the waveform-lane assertion non-deterministic. A
      // deterministic 2-track peaks document exercises the same renderer
      // wiring (store -> timeline -> lane canvases) the real pipeline feeds.
      ipcMain.removeHandler('generate-session-peaks');
      ipcMain.handle('generate-session-peaks', () => ({
        success: true,
        cached: false,
        peaks: {
          bucketsPerSecond: 50,
          tracks: [
            { index: 0, label: 'Kick', kind: 'mono', bucketCount: 1, data: Buffer.from([0, 255]).toString('base64') },
            { index: 1, label: 'OH', kind: 'stereo', bucketCount: 2, data: Buffer.from([64, 192, 32, 224]).toString('base64') },
          ],
        },
      }));
      ipcMain.removeHandler('start-playback');
      // __pbCalls records every start-playback invocation so a test can count
      // restarts (the #736 seek is one restart per gesture); __pb stays the
      // most recent opts for the existing assertions.
      (globalThis as Record<string, unknown>).__pbCalls = [];
      ipcMain.handle('start-playback', (_e, opts) => {
        (globalThis as Record<string, unknown>).__pb = opts;
        ((globalThis as Record<string, unknown>).__pbCalls as unknown[]).push(opts);
        return { success: true };
      });
      ipcMain.removeHandler('stop-playback');
      ipcMain.handle('stop-playback', () => ({ success: true }));
      // Live re-route while playing (#759): capture the pushed spec so the
      // hot-swap test can assert what reached the (stubbed) engine.
      ipcMain.removeHandler('set-playback-routes');
      ipcMain.handle('set-playback-routes', (_e, opts) => {
        (globalThis as Record<string, unknown>).__routes = opts; return { success: true };
      });
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

    // #735: one stacked waveform lane per track (canvas-wiring gate for the
    // /* c8 ignore */ draw effect — Playwright auto-waits for the stubbed
    // peaks generation to land).
    const lanes = window.locator('#sc-waveforms .sc-waveform-lane');
    await expect(lanes).toHaveCount(2);
    await expect(lanes.nth(0).locator('.sc-waveform-name')).toHaveText('Kick');
    await expect(lanes.nth(1).locator('.sc-waveform-name')).toHaveText('OH');
    await expect(lanes.nth(0).locator('canvas')).toBeVisible();
    await expect(lanes.nth(1).locator('canvas')).toBeVisible();
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

  test('hot-swaps a track route while playing without stopping (#759)', async () => {
    await window.locator('#sc-choose-btn').click();
    await window.locator('#sc-device-select').selectOption({ label: 'MOTU 8ch (8ch)' });
    await window.locator('#sc-play-btn').click();
    await expect(window.locator('#sc-stop-btn')).toBeVisible();

    const firstRoute = window.locator('#sc-tracks .sc-track').nth(0).locator('.sc-route');
    await expect(firstRoute).toBeEnabled();
    await firstRoute.selectOption('1');

    const routes = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__routes,
    )) as { route?: string };
    expect(routes.route).toBe('0:1,1:1-2');

    // Playback never stopped — the Stop control is still the transport.
    await expect(window.locator('#sc-stop-btn')).toBeVisible();
    await expect(window.locator('#sc-play-btn')).toBeHidden();
  });

  test('an ended event resets the transport', async () => {
    await window.locator('#sc-choose-btn').click();
    await window.locator('#sc-play-btn').click();
    await expect(window.locator('#sc-stop-btn')).toBeVisible();
    await sendPlaybackEvent({ type: 'ended' });
    await expect(window.locator('#sc-play-btn')).toBeVisible();
    await expect(window.locator('#sc-stop-btn')).toBeHidden();
  });

  test('renders a live playhead while playing and click-seeks on the waveform', async () => {
    await window.locator('#sc-choose-btn').click();
    await window.locator('#sc-play-btn').click();
    await expect(window.locator('#sc-stop-btn')).toBeVisible();

    // The playhead mounts with the lanes and turns visible on the first
    // coalesced progress tick (the same tick the readout rides).
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('#sc-elapsed')).toContainText('0:02 / 0:10');
    await expect(window.locator('#sc-playhead')).toHaveCSS('display', 'block');
    const left = await window.locator('#sc-playhead').evaluate((el) => (el as HTMLElement).style.left);
    expect(left).toMatch(/px$/);

    // A click inside the canvas column commits exactly one restart-based seek:
    // the stubbed start-playback handler records a second invocation carrying
    // a positive startOffsetSecs (ADR-0013 restart-with-start-offset). The
    // stubbed peaks give a 0.04s shared timeline (2 buckets @ 50 bps), so the
    // canvas-centre click lands somewhere in (0, 0.04).
    const waves = await window.locator('#sc-waveforms').boundingBox();
    const canvas = await window.locator('.sc-waveform-canvas').first().boundingBox();
    expect(waves).not.toBeNull();
    expect(canvas).not.toBeNull();
    await window.locator('#sc-waveforms').click({
      position: { x: canvas!.x - waves!.x + canvas!.width / 2, y: canvas!.y - waves!.y + canvas!.height / 2 },
    });
    const calls = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__pbCalls,
    )) as Array<{ startOffsetSecs?: number }>;
    expect(calls).toHaveLength(2);
    expect(calls[1].startOffsetSecs).toBeGreaterThan(0);
    expect(calls[1].startOffsetSecs).toBeLessThan(0.04);

    // The playhead survives the seek (still playing) and hides on stop.
    await expect(window.locator('#sc-playhead')).toBeVisible();
    await window.locator('#sc-stop-btn').click();
    await expect(window.locator('#sc-playhead')).toHaveCount(0);
  });
});
