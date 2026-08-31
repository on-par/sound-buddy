import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// #1325: the Session arrangement paints five independent time-positioned surfaces —
// ruler ticks, lane gridlines, the cached take clip, the scrub gesture's
// pointer-to-time mapping, and the playhead — and every one of them is supposed to
// resolve a given timestamp to the same shell-local x through the one shared geometry
// (ADR-0086's dawTimelineX origin + px-per-second, re-based by ADR-0090's single CSS
// translate). This spec proves that invariant in a running app by reading real DOM/canvas
// geometry (bounding boxes, computed style, and the pointer coordinates this test itself
// dispatches) — never screenshots — and asserting all five x-positions agree within a
// named pixel tolerance at the default zoom scale. It is IPC-stubbed (open-dir-dialog,
// generate-session-peaks, list-output-devices, start-playback), so it needs no
// sox/ffprobe/python and no packaged .app, and is deliberately NOT added to
// playwright.config.ts's MEDIA_SPECS. Zoom, scroll, resize, playback, follow-scroll, and
// loop-brace coverage of the same invariant are out of scope here and land in the sibling
// slices of epic #1258.

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', 'fixtures', 'session');

// Mirrors DAW_TIMELINE_PX_PER_SECOND / DAW_RULER_TICK_INTERVAL_SECS in
// renderer/src/daw-shell-runtime.ts. Declared locally rather than imported: no other
// app/tests file imports renderer source, and app/tsconfig.json only includes electron/**.
// The "default scale, no scroll" assertion below re-derives the spacing from the DOM so
// these cannot drift unnoticed.
const TIMELINE_PX_PER_SECOND = 8;
const RULER_TICK_INTERVAL_SECS = 5;
// The fixed timestamp every surface is measured at. Index 2 of both the ruler ticks and
// the lane gridlines (0s, 5s, 10s).
const ALIGNMENT_TIME_SECS = 10;
const ALIGNMENT_TICK_INDEX = ALIGNMENT_TIME_SECS / RULER_TICK_INTERVAL_SECS; // 2
// Same tolerance loopBrace.alignment.spec.ts uses: sub-pixel layout rounding only.
const ALIGNMENT_TOLERANCE_PX = 1;
// One pixel's worth of seconds — the epsilon for the committed seek time.
const SEEK_TOLERANCE_SECS = ALIGNMENT_TOLERANCE_PX / TIMELINE_PX_PER_SECOND;
// ADR-0014's peaks document: 50 buckets/sec, one interleaved min/max u8 pair per bucket.
// 500 buckets => the take clip spans exactly ALIGNMENT_TIME_SECS, so its RIGHT edge is the
// 10s tick. Track 0 of tests/fixtures/session/session.json is mono sourceChannels [0],
// which claims exactly one of the two default mono strips (a=0, a=1) seeded by
// liveCaptureStore's defaultChannelConfig.
const PEAKS_BUCKETS_PER_SECOND = 50;
const PEAK_BUCKETS = ALIGNMENT_TIME_SECS * PEAKS_BUCKETS_PER_SECOND; // 500

// Full-height min/max pairs (level 0 -> -1, level 255 -> +1, ADR-0004 quantization),
// mirroring daw-shell.spec.ts's helper of the same name.
function fullHeightPeaks(buckets: number): string {
  const levels: number[] = [];
  for (let i = 0; i < buckets; i++) levels.push(0, 255);
  return Buffer.from(levels).toString('base64');
}

test.describe('Timeline alignment invariant (#1325)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await electronApp.evaluate(({ ipcMain }, fixture) => {
      (globalThis as Record<string, unknown>).__alignmentSeek = null;
      ipcMain.removeHandler('open-dir-dialog');
      ipcMain.handle('open-dir-dialog', () => fixture.dir);
      ipcMain.removeHandler('generate-session-peaks');
      ipcMain.handle('generate-session-peaks', () => ({ success: true, cached: false, peaks: fixture.peaks }));
      ipcMain.removeHandler('list-output-devices');
      ipcMain.handle('list-output-devices', () => ({ devices: [{ index: 1, name: 'MOTU 8ch', channels: 8 }] }));
      // Releasing the scrub commits a seek through soundcheckStore.seekTo -> start-playback.
      // Stub it so no playback.py is spawned and the committed offset is observable.
      ipcMain.removeHandler('start-playback');
      ipcMain.handle('start-playback', (_event, opts) => {
        (globalThis as Record<string, unknown>).__alignmentSeek = opts;
        return { success: true };
      });
    }, {
      dir: SESSION_DIR,
      peaks: {
        bucketsPerSecond: PEAKS_BUCKETS_PER_SECOND,
        tracks: [{ index: 0, kind: 'mono', bucketCount: PEAK_BUCKETS, data: fullHeightPeaks(PEAK_BUCKETS) }],
      },
    });
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await stopCaptureIfRunning(window);
    await window.locator('.mode-tab[data-mode="live"]').click();
    // Seed channelConfig: liveCaptureStore.loadDevices() is only reachable from the Settings ->
    // Audio refresh button (LiveSourceSettings.tsx), and window.reload() clears the store — so
    // without this there are no lanes and no gridlines. Same dance as inline-track-definition.spec.ts.
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#device-refresh-btn').click();
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('.daw-channel-lane')).toHaveCount(2);
    // A monitor session may have started while devices were seeded; the rAF playhead loop
    // only runs while capturing and would repaint over the scrub preview.
    await stopCaptureIfRunning(window);
    await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
    await expect(window.locator('#daw-session-play')).toBeEnabled();
    await expect(window.locator('.daw-take-clip')).toHaveCount(1);
  });

  test('ruler tick, lane gridline, clip edge, scrub target and playhead share one x at default scale (#1325)', async () => {
    // Pin "default scale, no scroll" (geometry, not a screenshot) and prove the local
    // TIMELINE_PX_PER_SECOND/RULER_TICK_INTERVAL_SECS constants above have not drifted from
    // the renderer's DAW_TIMELINE_PX_PER_SECOND/DAW_RULER_TICK_INTERVAL_SECS.
    const shell = window.locator('.daw-shell');
    expect(await shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim())).toBe('0px');
    const ticks = window.locator('.daw-ruler .daw-ruler-tick');
    const tick0 = (await ticks.nth(0).boundingBox())!;
    const tickAt = (await ticks.nth(ALIGNMENT_TICK_INDEX).boundingBox())!;
    const measuredPxPerSecond = (tickAt.x - tick0.x) / ALIGNMENT_TIME_SECS;
    expect(Math.abs(measuredPxPerSecond - TIMELINE_PX_PER_SECOND))
      .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);

    // Reading 1 — ruler tick x: tickAt.x (the reference every other reading is compared to).

    // Reading 2 — lane gridline x.
    const gridline = window.locator('.daw-channel-lane[data-ch="0"] .daw-lane-grid .daw-gridline')
      .nth(ALIGNMENT_TICK_INDEX);
    const gridlineX = (await gridline.boundingBox())!.x;

    // Reading 3 — take clip right edge x: the clip starts at t=0 and spans exactly
    // ALIGNMENT_TIME_SECS, so its right edge is the 10s position.
    const clipBox = (await window.locator('.daw-channel-lane[data-ch="0"] .daw-take-clip').boundingBox())!;
    const clipEdgeX = clipBox.x + clipBox.width;

    // Reading 4 — scrub target x: the pointer position the scrub maps to ALIGNMENT_TIME_SECS.
    // beginSessionTimelineScrub measures from the pressed surface's own left edge
    // (surfaceEl.getBoundingClientRect().left), which is the shared t=0 edge.
    const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
    // Rounded because Chromium delivers integral clientX to the page; the residual <=0.5px
    // is absorbed by ALIGNMENT_TOLERANCE_PX.
    const scrubTargetX = Math.round(rulerBox.x + ALIGNMENT_TIME_SECS * TIMELINE_PX_PER_SECOND);

    // Reading 5 — playhead x: hold a ruler scrub at the scrub target. The scrub's
    // previewLeftPx writes the one shared shell-local x onto every .daw-playhead segment,
    // so this is the playhead's painted position for ALIGNMENT_TIME_SECS on a stopped
    // session (no playback, no recording — both out of scope).
    await window.mouse.move(scrubTargetX, rulerBox.y + rulerBox.height / 2);
    await window.mouse.down();
    const playheadLaneX = (await window.locator('.daw-playhead-lanes').boundingBox())!.x;
    const playheadRulerX = (await window.locator('.daw-playhead-ruler').boundingBox())!.x;

    const expectAligned = (label: string, x: number) => {
      expect(Math.abs(x - tickAt.x), `${label} is ${x}px, ruler tick is ${tickAt.x}px`)
        .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
    };
    expectAligned('lane gridline', gridlineX);
    expectAligned('take clip right edge', clipEdgeX);
    expectAligned('scrub target', scrubTargetX);
    expectAligned('lane playhead', playheadLaneX);
    expectAligned('ruler playhead', playheadRulerX);

    // Commit the scrub and prove the target means 10 seconds, not just this many pixels.
    await window.mouse.up();
    const seek = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__alignmentSeek,
    )) as { startOffsetSecs?: number } | null;
    expect(seek).not.toBeNull();
    expect(Math.abs((seek!.startOffsetSecs ?? NaN) - ALIGNMENT_TIME_SECS))
      .toBeLessThanOrEqual(SEEK_TOLERANCE_SECS);
  });
});
