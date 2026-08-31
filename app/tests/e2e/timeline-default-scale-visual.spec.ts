import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// #1295: the last acceptance criterion of #1267 that automated x-position checks cannot
// close — a human LOOKING at the default-scale Session arrangement (ruler ticks, lane
// gridlines, the take clip, its waveform columns, and the playhead) and confirming none of
// them carries a visual artifact that numeric x-agreement is blind to (a gridline the
// compositor drops to zero width, waveform columns clipped by overflow, a playhead painted
// behind the lane background, a clip edge hidden under lane chrome). timeline-alignment.spec.ts
// (#1325) and timeline-zoom-state-alignment.spec.ts (#1297) already prove every surface
// resolves one timestamp to one shared x; this spec never re-derives that proof. Per
// ADR-0124, alignment stays the exclusive property of those DOM-geometry specs — this file
// asserts PAINTEDNESS only (attached, visible, non-zero extent, the waveform canvas carries
// ink) and then captures a PNG of the arrangement for a human reviewer, documented as the
// human gate in docs/session-timeline-default-scale-visual-verification.md. It never compares
// images and never gains a toHaveScreenshot baseline.
//
// IPC-stubbed only (open-dir-dialog, generate-session-peaks, list-output-devices,
// start-playback) — no sox/ffprobe/python, no packaged .app — so it is deliberately NOT
// added to playwright.config.ts's MEDIA_SPECS.

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', 'fixtures', 'session');

// Mirrors DAW_TIMELINE_PX_PER_SECOND (daw-shell-runtime.ts).
const TIMELINE_PX_PER_SECOND = 8;
// Mirrors DAW_RULER_TICK_INTERVAL_SECS.
const RULER_TICK_INTERVAL_SECS = 5;
// Where the playhead is held for the capture — a value that lands on both a ruler tick and
// a lane gridline (multiple of RULER_TICK_INTERVAL_SECS).
const INSPECTION_TIME_SECS = 10;
const INSPECTION_TICK_INDEX = INSPECTION_TIME_SECS / RULER_TICK_INTERVAL_SECS; // 2
// Sub-pixel layout rounding over a 10s span — same shape of tolerance the sibling alignment
// specs use, scaled to a px/s epsilon.
const PX_PER_SECOND_TOLERANCE = 0.1;
// ADR-0014's peaks document rate: 50 buckets/sec, one interleaved min/max u8 pair per bucket.
const PEAKS_BUCKETS_PER_SECOND = 50;
const PEAK_BUCKETS = INSPECTION_TIME_SECS * PEAKS_BUCKETS_PER_SECOND; // 500
// The waveform canvas must carry ink somewhere, not be blank.
const MIN_PAINTED_WAVEFORM_COLUMNS = 1;

// Full-height min/max pairs (level 0 -> -1, level 255 -> +1, ADR-0004 quantization), copied
// verbatim from timeline-alignment.spec.ts's helper of the same name.
function fullHeightPeaks(buckets: number): string {
  const levels: number[] = [];
  for (let i = 0; i < buckets; i++) levels.push(0, 255);
  return Buffer.from(levels).toString('base64');
}

interface DefaultScaleSurfaceReadings {
  scrollOffset: string;
  tickCount: number;
  tickPxPerSecond: number;
  gridlineCount: number;
  gridlineWidthPx: number;
  clipWidthPx: number;
  clipHeightPx: number;
  canvasWidthPx: number;
  canvasHeightPx: number;
  paintedWaveformColumns: number;
  // The playhead's two region segments (#1049): laneHead* is .daw-playhead-lanes,
  // rulerHead* is .daw-playhead-ruler.
  laneHeadWidthPx: number;
  rulerHeadWidthPx: number;
  laneHeadVisible: boolean;
  rulerHeadVisible: boolean;
}

// Stages the exact default-scale scene the human inspects: stub the IPC handlers the fixture
// session needs, seed the two live lanes (the only path that reaches liveCaptureStore's
// channelConfig), then open the fixture session folder. Lifted from timeline-alignment.spec.ts's
// beforeEach (#1325), minus the start-playback seek recorder — this spec never releases the
// scrub, so no seek is ever committed and there is nothing to record. The start-playback stub
// itself stays so a released scrub (if the capture path ever needs one) cannot spawn playback.py.
async function stageDefaultScaleScene(): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler('open-dir-dialog');
    ipcMain.handle('open-dir-dialog', () => fixture.dir);
    ipcMain.removeHandler('generate-session-peaks');
    ipcMain.handle('generate-session-peaks', () => ({ success: true, cached: false, peaks: fixture.peaks }));
    ipcMain.removeHandler('list-output-devices');
    ipcMain.handle('list-output-devices', () => ({ devices: [{ index: 1, name: 'MOTU 8ch', channels: 8 }] }));
    ipcMain.removeHandler('start-playback');
    ipcMain.handle('start-playback', () => ({ success: true }));
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
  // Audio refresh button, and window.reload() clears the store — without this there are no
  // lanes and no gridlines. Same dance as timeline-alignment.spec.ts.
  await window.locator('#settings-btn').click();
  await window.locator('#settings-tab-btn-audio').click();
  await window.locator('#device-refresh-btn').click();
  await window.locator('#settings-dialog-done').click();
  await expect(window.locator('.daw-channel-lane')).toHaveCount(2);
  // A monitor session may have started while devices were seeded; the rAF playhead loop only
  // runs while capturing and would repaint over the held scrub.
  await stopCaptureIfRunning(window);

  await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
  await expect(window.locator('#daw-session-play')).toBeEnabled();
  await expect(window.locator('.daw-take-clip')).toHaveCount(1);
}

// One page.evaluate returning the paintedness of the five inspected surfaces.
async function readDefaultScaleSurfaces(): Promise<DefaultScaleSurfaceReadings> {
  return window.evaluate(({ tickIndex, timeSecs }) => {
    const shell = document.querySelector('.daw-shell') as HTMLElement;
    const scrollOffset = getComputedStyle(shell).getPropertyValue('--daw-scroll-x').trim();

    const ticks = document.querySelectorAll('.daw-ruler .daw-ruler-tick');
    const tick0 = ticks[0].getBoundingClientRect();
    const tickAt = ticks[tickIndex].getBoundingClientRect();
    const tickPxPerSecond = (tickAt.x - tick0.x) / timeSecs;

    const gridlines = document.querySelectorAll(
      '.daw-channel-lane[data-ch="0"] .daw-lane-grid .daw-gridline',
    );
    const gridlineWidthPx = gridlines[tickIndex].getBoundingClientRect().width;

    const clipRect = document
      .querySelector('.daw-channel-lane[data-ch="0"] .daw-take-clip')!
      .getBoundingClientRect();

    const canvas = document.querySelector(
      '.daw-channel-lane[data-ch="0"] .daw-take-clip canvas',
    ) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedWaveformColumns = 0;
    for (let x = 0; x < canvas.width; x++) {
      let inked = false;
      for (let y = 0; y < canvas.height; y++) {
        if (img[(y * canvas.width + x) * 4 + 3] !== 0) {
          inked = true;
          break;
        }
      }
      if (inked) paintedWaveformColumns++;
    }

    // The playhead's two region segments (#1049): one in the lane column, one in the ruler.
    const laneHead = document.querySelector('.daw-playhead-lanes') as HTMLElement;
    const rulerHead = document.querySelector('.daw-playhead-ruler') as HTMLElement;
    const laneHeadStyle = getComputedStyle(laneHead);
    const rulerHeadStyle = getComputedStyle(rulerHead);

    return {
      scrollOffset,
      tickCount: ticks.length,
      tickPxPerSecond,
      gridlineCount: gridlines.length,
      gridlineWidthPx,
      clipWidthPx: clipRect.width,
      clipHeightPx: clipRect.height,
      canvasWidthPx: canvas.width,
      canvasHeightPx: canvas.height,
      paintedWaveformColumns,
      laneHeadWidthPx: laneHead.getBoundingClientRect().width,
      rulerHeadWidthPx: rulerHead.getBoundingClientRect().width,
      laneHeadVisible: laneHeadStyle.visibility !== 'hidden' && laneHeadStyle.display !== 'none',
      rulerHeadVisible: rulerHeadStyle.visibility !== 'hidden' && rulerHeadStyle.display !== 'none',
    };
  }, { tickIndex: INSPECTION_TICK_INDEX, timeSecs: INSPECTION_TIME_SECS });
}

test.describe('Default-scale Session timeline visual verification (#1295)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  // Playwright statically requires the first arg to be a destructuring pattern naming the
  // fixtures used (none, here) — the empty pattern is unavoidable, not a real lint smell.
  // eslint-disable-next-line no-empty-pattern
  test('every default-scale timeline surface is painted, and the arrangement is captured for visual review (#1295)', async ({}, testInfo) => {
    await stageDefaultScaleScene();

    // Hold the playhead at INSPECTION_TIME_SECS with a real ruler press, so it is visible in
    // the captured artifact and readDefaultScaleSurfaces can measure it.
    const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
    await window.mouse.move(
      Math.round(rulerBox.x + INSPECTION_TIME_SECS * TIMELINE_PX_PER_SECOND),
      rulerBox.y + rulerBox.height / 2,
    );
    await window.mouse.down();

    try {
      const surfaces = await readDefaultScaleSurfaces();

      expect(surfaces.scrollOffset, 'shell scroll offset should be 0 — this is the default, unscrolled scale').toBe('0px');
      expect(
        Math.abs(surfaces.tickPxPerSecond - TIMELINE_PX_PER_SECOND),
        `ruler px/s ${surfaces.tickPxPerSecond} drifted from DAW_TIMELINE_PX_PER_SECOND ${TIMELINE_PX_PER_SECOND}`,
      ).toBeLessThanOrEqual(PX_PER_SECOND_TOLERANCE);
      expect(surfaces.tickCount, 'ruler ticks should be painted past the inspection index').toBeGreaterThan(INSPECTION_TICK_INDEX);
      expect(surfaces.gridlineCount, 'lane gridlines should be painted past the inspection index').toBeGreaterThan(INSPECTION_TICK_INDEX);
      expect(surfaces.gridlineWidthPx, 'lane gridline at the inspection index has zero painted width').toBeGreaterThan(0);
      expect(surfaces.clipWidthPx, 'take clip has zero painted width').toBeGreaterThan(0);
      expect(surfaces.clipHeightPx, 'take clip has zero painted height').toBeGreaterThan(0);
      expect(surfaces.canvasWidthPx, 'waveform canvas has zero width').toBeGreaterThan(0);
      expect(surfaces.canvasHeightPx, 'waveform canvas has zero height').toBeGreaterThan(0);
      expect(
        surfaces.paintedWaveformColumns,
        'waveform canvas carries no ink — it is blank',
      ).toBeGreaterThanOrEqual(MIN_PAINTED_WAVEFORM_COLUMNS);
      expect(surfaces.laneHeadWidthPx, 'lane playhead segment has zero painted width').toBeGreaterThan(0);
      expect(surfaces.rulerHeadWidthPx, 'ruler playhead segment has zero painted width').toBeGreaterThan(0);
      expect(surfaces.laneHeadVisible, 'lane playhead segment is hidden').toBe(true);
      expect(surfaces.rulerHeadVisible, 'ruler playhead segment is hidden').toBe(true);

      // Capture the arrangement while the scrub is still held, so the playhead is visible in
      // the artifact. Electron builds the window with show:false under SB_E2E_HEADLESS=1, so a
      // hidden-window capture may not be possible — degrade to an annotation rather than fail
      // the paintedness assertions above over an unrelated capture problem.
      try {
        const png = await window.locator('.daw-shell').screenshot();
        expect(png.byteLength, 'captured screenshot is empty').toBeGreaterThan(0);
        await testInfo.attach('session-timeline-default-scale', { body: png, contentType: 'image/png' });
        const outPath = testInfo.outputPath('session-timeline-default-scale.png');
        fs.writeFileSync(outPath, png);
        console.log(`session-timeline-default-scale.png written to ${outPath}`);
      } catch (err) {
        testInfo.annotations.push({
          type: 'capture-unavailable',
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      await window.mouse.up();
    }
  });
});
