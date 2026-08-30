import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from '../../tests/e2e/e2e-helpers';

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'session');
const ROUTING_DRAWER_WIDTH_TOLERANCE_PX = 1;
const MONITORING_ELAPSED_ASSERTION_WAIT_MS = 1_100;

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
      // Reset alongside the call log: this lives on the MAIN-process global,
      // which survives window.reload() and every test in the file. Left
      // sticky, the first test's stop-playback click made
      // 'routing-mid-playback' below fail on its first attempt forever —
      // masked on CI only because playwright.config.ts retries twice in a
      // FRESH worker (new Electron app, clean globals).
      (globalThis as Record<string, unknown>).__sessionPlaybackStopped = false;
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

  test('jumps stopped Session playback from the ruler scrub zone with nothing selected (#1285)', async () => {
    const startCalls = async (): Promise<{ startOffsetSecs?: number }[]> => electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackCalls,
    ) as Promise<{ startOffsetSecs?: number }[]>;
    expect(await startCalls()).toHaveLength(0);

    const ruler = window.locator('.daw-ruler');
    await expect(ruler).toHaveCSS('cursor', 'ew-resize');
    const rulerBox = await ruler.boundingBox();
    expect(rulerBox).not.toBeNull();

    await window.mouse.move(rulerBox!.x, rulerBox!.y + rulerBox!.height / 2);
    await window.mouse.down();
    await window.mouse.move(rulerBox!.x + 4, rulerBox!.y + rulerBox!.height / 2);
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '212px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '212px');
    expect(await startCalls()).toHaveLength(0);

    await expect(window.locator('.daw-track-head.selected')).toHaveCount(0);

    await window.mouse.up();
    await expect.poll(startCalls).toHaveLength(1);
    expect((await startCalls())[0].startOffsetSecs).toBe(0.5);
  });

  test('pauses follow-scroll on a manual timeline wheel and resumes it on Play (#1286)', async () => {
    const followToggle = window.locator('#daw-follow-toggle');
    await expect(followToggle).toHaveAttribute('aria-pressed', 'true');

    await window.locator('.daw-timeline').dispatchEvent('wheel', { deltaX: 120, deltaY: 0, bubbles: true });
    await expect(followToggle).toHaveAttribute('aria-pressed', 'false');

    await window.locator('#daw-session-play').click();
    await expect(followToggle).toHaveAttribute('aria-pressed', 'true');
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

  test('BPM change does not affect playback, scrub, waveform, or clip state (#1277)', async () => {
    // Render a take clip: swap the empty-peaks stub for a real mono track so
    // .daw-take-clip renders on channel 0 (session.json track 0 is mono,
    // sourceChannels [0], matching the default channelConfig's a = index seed).
    const BUCKETS_PER_SECOND = 50;
    const CLIP_SECS = 10;
    const bucketCount = BUCKETS_PER_SECOND * CLIP_SECS; // 500 buckets -> 10s
    const bytes: number[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const amplitude = Math.round(120 * Math.abs(Math.sin(i / 12))); // shaped so the canvas isn't flat
      bytes.push(127 - amplitude, 128 + amplitude);
    }
    const peaks = {
      bucketsPerSecond: BUCKETS_PER_SECOND,
      tracks: [{ index: 0, kind: 'mono', bucketCount, data: Buffer.from(bytes).toString('base64') }],
    };
    await electronApp.evaluate(({ ipcMain }, doc) => {
      ipcMain.removeHandler('generate-session-peaks');
      ipcMain.handle('generate-session-peaks', () => ({ success: true, cached: false, peaks: doc }));
    }, peaks);
    await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
    const clip = window.locator('.daw-channel-lane[data-ch="0"] .daw-take-clip');
    await expect(clip).toHaveCount(1);

    // Seed a real-seconds transport position.
    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');
    // DAW_TIMELINE_ORIGIN_PX (208) + 2s * DAW_TIMELINE_PX_PER_SECOND (8) = 224px.
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '224px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '224px');

    // Capture the real-seconds baseline.
    const readTickLefts = async (): Promise<string[]> => window.locator('.daw-ruler .daw-ruler-tick')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.left));
    const readLabelLefts = async (): Promise<string[]> => window.locator('.daw-ruler .daw-ruler-label')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.left));
    const readLabelTimes = async (): Promise<string[]> => window.locator('.daw-ruler .daw-ruler-label .daw-ruler-label-time')
      .evaluateAll((els) => els.map((el) => el.textContent));
    const readClipCanvas = async (): Promise<{ width: number; height: number; dataUrl: string }> => clip
      .locator('canvas')
      .evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        return { width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL() };
      });
    const canvasPaintedAtMidpoint = async (): Promise<boolean> => clip.locator('canvas').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      if (canvas.width === 0 || canvas.height === 0) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const { data } = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1);
      return data[3] > 0;
    });

    const baselineTickLefts = await readTickLefts();
    const baselineLabelLefts = await readLabelLefts();
    const baselineLabelTimes = await readLabelTimes();
    await expect(clip).toHaveCSS('width', '80px');
    await expect.poll(canvasPaintedAtMidpoint).toBe(true);
    const baselineClipCanvas = await readClipCanvas();
    expect(baselineClipCanvas.width).toBeGreaterThan(0);
    expect(baselineClipCanvas.height).toBeGreaterThan(0);

    const rulerLabels = window.locator('.daw-ruler .daw-ruler-label');
    await expect(rulerLabels.nth(0).locator('.daw-ruler-label-bars')).toHaveText('1.1');
    await expect(rulerLabels.nth(1).locator('.daw-ruler-label-bars')).toHaveText('6.1');
    await expect(rulerLabels.nth(1).locator('.daw-ruler-label-time')).toHaveText('0:10');

    // Scrub #1 (the "before" seek target).
    const startCalls = async (): Promise<{ startOffsetSecs?: number }[]> => electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__sessionPlaybackCalls,
    ) as Promise<{ startOffsetSecs?: number }[]>;
    const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
    await window.mouse.move(rulerBox.x, rulerBox.y + rulerBox.height / 2);
    await window.mouse.down();
    // 26px right of the ruler's left edge -> 26 / 8 = 3.25s. Exact in binary
    // floating point, so toBe is correct here — no epsilon needed.
    await window.mouse.move(rulerBox.x + 26, rulerBox.y + rulerBox.height / 2);
    await window.mouse.up();
    await expect.poll(startCalls).toHaveLength(2);
    expect((await startCalls())[1].startOffsetSecs).toBe(3.25);

    // Restore the position baseline so the post-change comparison is apples-to-apples.
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '224px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '224px');

    // Change the BPM. 173 is deliberately not a divisor of 60: at 173 BPM one
    // beat is 60/173 ≈ 0.3468s, so the 3.25s seek target below cannot be a
    // snapped beat boundary.
    await window.locator('#daw-session-bpm').fill('173');
    await window.locator('#daw-session-bpm').press('Tab');
    await expect(window.locator('#daw-session-bpm')).toHaveValue('173');
    await expect(window.locator('#daw-session-bpm')).toHaveAttribute('aria-invalid', 'false');

    // Acceptance criterion 1: the ruler re-labels.
    await expect(rulerLabels.nth(1).locator('.daw-ruler-label-bars')).toHaveText('8.1');
    await expect(rulerLabels.nth(0).locator('.daw-ruler-label-bars')).toHaveText('1.1');

    // Acceptance criterion 2: every real-seconds value is unchanged, despite
    // the BPM commit rebuilding LiveCapturePanel's entire board markup.
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');
    await expect(window.locator('.daw-playhead-ruler')).toHaveCSS('left', '224px');
    await expect(window.locator('.daw-playhead-lanes')).toHaveCSS('left', '224px');
    expect(await readTickLefts()).toEqual(baselineTickLefts);
    expect(await readLabelLefts()).toEqual(baselineLabelLefts);
    expect(await readLabelTimes()).toEqual(baselineLabelTimes);
    await expect(clip).toHaveCSS('width', '80px');
    await expect.poll(readClipCanvas).toEqual(baselineClipCanvas);

    // Scrub #2 (the "after" seek target) — identical gesture, identical
    // unrounded offset: the observational proof that no quantize/snap/warp
    // path ran.
    await window.mouse.move(rulerBox.x, rulerBox.y + rulerBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(rulerBox.x + 26, rulerBox.y + rulerBox.height / 2);
    await window.mouse.up();
    await expect.poll(startCalls).toHaveLength(3);
    expect((await startCalls())[2].startOffsetSecs).toBe(3.25);
    await expect(window.locator('.daw-transport-time')).toHaveText('0:03');
  });

  test('session-tab-playback-monitoring keeps the live meter updating during take playback', async () => {
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('LIVE');

    await window.locator('#daw-session-routing-toggle').click();
    await window.locator('#daw-session-output-device').selectOption({ label: 'MOTU 8ch (8ch)' });
    await window.locator('#daw-session-play').click();
    await sendPlaybackEvent({ type: 'progress', elapsed: 2, duration: 10 });
    await expect(window.locator('.daw-transport-time')).toHaveText('0:02');

    await sendLiveEvent({ type: 'meter', channels: [{ rms: -18, peak: -6 }] });
    await expect(window.locator('.daw-track-head-level-fill').first()).toHaveAttribute('style', 'width:78.26086956521739%');
  });

  test('session-timeline-monitoring', async () => {
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('LIVE');

    const rulerPlayhead = window.locator('.daw-playhead-ruler');
    const lanePlayhead = window.locator('.daw-playhead-lanes');
    const transport = window.locator('.daw-transport-time');
    const timeline = window.locator('.daw-timeline');
    const [rulerLeft, laneLeft, transportText, timelineScrollLeft] = await Promise.all([
      rulerPlayhead.evaluate((element) => (element as HTMLElement).style.left),
      lanePlayhead.evaluate((element) => (element as HTMLElement).style.left),
      transport.textContent(),
      timeline.evaluate((element) => (element as HTMLElement).scrollLeft),
    ]);

    await sendLiveEvent({ type: 'meter', channels: [{ rms: -18, peak: -6 }] });
    await window.waitForTimeout(MONITORING_ELAPSED_ASSERTION_WAIT_MS);

    await expect(rulerPlayhead).toHaveCSS('left', rulerLeft);
    await expect(lanePlayhead).toHaveCSS('left', laneLeft);
    await expect(transport).toHaveText(transportText ?? '');
    expect(await timeline.evaluate((element) => (element as HTMLElement).scrollLeft)).toBe(timelineScrollLeft);
    await expect(rulerPlayhead).not.toHaveClass(/advancing/);
    await expect(lanePlayhead).not.toHaveClass(/advancing/);
  });

  test('Session Record and the persistent header share capture state across tabs (#1081)', async () => {
    const sessionRecord = window.locator('#daw-session-record');
    await expect(sessionRecord).toBeEnabled();
    await sessionRecord.click();
    await expect(window.locator('#record-button-island')).toBeHidden();
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
