import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// #1297: the Session arrangement paints SIX independent time-positioned surfaces —
// ruler ticks, lane gridlines, the cached take clip, the waveform columns painted
// inside that clip, the scrub gesture's pointer-to-time mapping, and the playhead —
// and this spec proves they all resolve one shared timestamp to one x-position, with
// the shared Session timeline scale parked in each of its four zoom states. It reads
// real DOM and canvas geometry (bounding boxes, computed style, and a getImageData
// column scan) — never screenshots. timeline-alignment.spec.ts (#1325-#1329) already
// covers five of these six surfaces at the default scale, after zoom/pan/resize, and
// during playback/recording; this file adds the waveform-column surface (covered by
// nothing else) and iterates the four named scale states.
//
// The four states are driven through window.__soundBuddyTimelineScale (#1294,
// SOUND_BUDDY_TEST_HOOKS=1) rather than the #1284 toolbar zoom buttons: the buttons
// cannot express 'fit', and #1326 already covers them.
//
// IMPORTANT: in this checkout nothing paints from sessionTimelineScaleModel —
// live-workspace-view.ts's SESSION_TIMELINE_SCALE ('default', 8px/s) is still the only
// scale the shell renders from, and the #1284 zoom buttons do not change painted
// px-per-second either (timeline-alignment.spec.ts asserts 8px/s after every zoom).
// ADR-0111 parks the wiring that would change this in #1283. So in this checkout the
// four hook states vary the shared scale MODEL, not the painted pixels — this spec
// therefore asserts the six surfaces agree with EACH OTHER at whatever scale the app
// actually paints, and deliberately never asserts painted px-per-second equals the
// hook's pxPerSecond. Because every expected x below is derived from the app's own
// measured geometry (never a hardcoded pixel value), the spec stays valid and
// meaningful once #1283 lands and wires the model into paint.
//
// IPC-stubbed only (open-dir-dialog, generate-session-peaks, list-output-devices,
// start-playback) — no sox/ffprobe/python, no packaged .app — so it is deliberately
// NOT added to playwright.config.ts's MEDIA_SPECS.

let electronApp: ElectronApplication;
let window: Page;

const SESSION_DIR = path.join(__dirname, '..', 'fixtures', 'session');

interface TimelineScaleSnapshot {
  state: string;
  pxPerSecond: number;
  fit: { durationSecs: number; viewportWidthPx: number } | null;
}

declare global {
  interface Window {
    __soundBuddyTimelineScale?: {
      setState(state: string, fit?: { durationSecs: number; viewportWidthPx: number }): TimelineScaleSnapshot;
      getState(): TimelineScaleSnapshot;
      reset(): TimelineScaleSnapshot;
    };
  }
}

const TIMELINE_SCALE_STATES = ['fit', 'default', 'zoomed-in', 'zoomed-out'] as const;

// Mirrors DAW_TIMELINE_PX_PER_SECOND (daw-shell-runtime.ts) — used only as a drift
// check on the MEASURED value below, never as an expected x.
const TIMELINE_PX_PER_SECOND = 8;
// Mirrors DAW_RULER_TICK_INTERVAL_SECS; lane gridlines use the same 5s minor division
// (DAW_LANE_GRID_MINOR_SECS), so tick index N and gridline index N are the same time.
const RULER_TICK_INTERVAL_SECS = 5;
// The one shared time value every surface is measured at.
const ALIGNMENT_TIME_SECS = 10;
const ALIGNMENT_TICK_INDEX = ALIGNMENT_TIME_SECS / RULER_TICK_INTERVAL_SECS; // 2
// Sub-pixel layout rounding only — same tolerance the sibling alignment specs use.
const ALIGNMENT_TOLERANCE_PX = 1;
// One pixel's worth of seconds — the epsilon for the committed seek time.
const SEEK_TOLERANCE_SECS = ALIGNMENT_TOLERANCE_PX / TIMELINE_PX_PER_SECOND;
// Mirror TIMELINE_SCALE_MIN_PX_PER_SECOND / TIMELINE_SCALE_MAX_PX_PER_SECOND in
// timeline-scale.ts — needed to predict the clamped 'fit' value.
const SCALE_MIN_PX_PER_SECOND = 2;
const SCALE_MAX_PX_PER_SECOND = 32;
// Float comparison epsilon for the resolved 'fit' pxPerSecond; clampTimelineScale is
// the pure function producing the value.
const FIT_SCALE_TOLERANCE_PX_PER_SECOND = 0.001;

// ADR-0014's peaks document rate: 50 buckets/sec, one interleaved min/max u8 pair per
// bucket.
const PEAKS_BUCKETS_PER_SECOND = 50;
const WAVEFORM_LOUD_SECS = 10;
const WAVEFORM_SILENT_SECS = 10;
const LOUD_BUCKETS = WAVEFORM_LOUD_SECS * PEAKS_BUCKETS_PER_SECOND; // 500
const SILENT_BUCKETS = WAVEFORM_SILENT_SECS * PEAKS_BUCKETS_PER_SECOND; // 500
// The clip spans 0-20s, so the waveform's loud->silent step falls exactly on
// ALIGNMENT_TIME_SECS.
const CLIP_SPAN_SECS = WAVEFORM_LOUD_SECS + WAVEFORM_SILENT_SECS; // 20

// u8 quantization (decodePeaksPairs: level 0 -> -1, 255 -> +1, 128 -> ~0), which
// drawDawWaveformLane paints as a 1px hairline for silence and a full-height column
// for full-scale loudness.
const PEAK_LEVEL_MIN = 0;
const PEAK_LEVEL_MAX = 255;
const PEAK_LEVEL_SILENT = 128;
// A canvas column counts as "loud" when more than half its pixels are painted; a
// silent column paints only a 1px hairline, so the two are unambiguous.
const LOUD_COLUMN_MIN_FILL_RATIO = 0.5;

const HOOK_READY_TIMEOUT_MS = 5000;

// Interleaved min/max u8 bytes, base64-packed (ADR-0014). Full-height buckets first,
// then silent ones, so the painted waveform has a single loud->silent step at
// loudBuckets / PEAKS_BUCKETS_PER_SECOND seconds.
function steppedPeaks(loudBuckets: number, silentBuckets: number): string {
  const levels: number[] = [];
  for (let i = 0; i < loudBuckets; i++) levels.push(PEAK_LEVEL_MIN, PEAK_LEVEL_MAX);
  for (let i = 0; i < silentBuckets; i++) levels.push(PEAK_LEVEL_SILENT, PEAK_LEVEL_SILENT);
  return Buffer.from(levels).toString('base64');
}

interface SixSurfaceGeometry {
  scrollOffsetPx: number;
  tickZeroX: number;
  tickAtX: number;
  tickPxPerSecond: number;
  gridZeroX: number;
  gridAtX: number;
  gridPxPerSecond: number;
  clipLeftX: number;
  clipRightX: number;
  clipPxPerSecond: number;
  waveformStepX: number;
  waveformLoudColumns: number;
  canvasWidthPx: number;
}

// One page.evaluate returning the painted geometry of five of the six surfaces (the
// scrub target and playhead are measured separately in assertSixSurfacesAlign, since
// they require a real pointer gesture).
async function readSixSurfaceGeometry(): Promise<SixSurfaceGeometry> {
  return window.evaluate(({ tickIndex, timeSecs, clipSpanSecs, loudFillRatio }) => {
    const shell = document.querySelector('.daw-shell') as HTMLElement;
    const scrollOffsetPx = parseFloat(getComputedStyle(shell).getPropertyValue('--daw-scroll-x'));

    const ticks = document.querySelectorAll('.daw-ruler .daw-ruler-tick');
    const tick0 = ticks[0].getBoundingClientRect();
    const tickAt = ticks[tickIndex].getBoundingClientRect();
    const tickZeroX = tick0.x;
    const tickAtX = tickAt.x;
    const tickPxPerSecond = (tickAtX - tickZeroX) / timeSecs;

    const gridlines = document.querySelectorAll(
      '.daw-channel-lane[data-ch="0"] .daw-lane-grid .daw-gridline',
    );
    const grid0 = gridlines[0].getBoundingClientRect();
    const gridAt = gridlines[tickIndex].getBoundingClientRect();
    const gridZeroX = grid0.x;
    const gridAtX = gridAt.x;
    const gridPxPerSecond = (gridAtX - gridZeroX) / timeSecs;

    const clipRect = document
      .querySelector('.daw-channel-lane[data-ch="0"] .daw-take-clip')!
      .getBoundingClientRect();
    const clipLeftX = clipRect.x;
    const clipRightX = clipRect.x + clipRect.width;
    const clipPxPerSecond = (clipRightX - clipLeftX) / clipSpanSecs;

    const canvas = document.querySelector(
      '.daw-channel-lane[data-ch="0"] .daw-take-clip canvas',
    ) as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let waveformLoudColumns = 0;
    let stepIndex = canvas.width;
    for (let x = 0; x < canvas.width; x++) {
      let painted = 0;
      for (let y = 0; y < canvas.height; y++) {
        if (img[(y * canvas.width + x) * 4 + 3] !== 0) painted++;
      }
      const isLoud = painted > canvas.height * loudFillRatio;
      if (isLoud) {
        waveformLoudColumns++;
      } else {
        stepIndex = x;
        break;
      }
    }
    const waveformStepX = canvasRect.x + stepIndex * (canvasRect.width / canvas.width);

    return {
      scrollOffsetPx,
      tickZeroX,
      tickAtX,
      tickPxPerSecond,
      gridZeroX,
      gridAtX,
      gridPxPerSecond,
      clipLeftX,
      clipRightX,
      clipPxPerSecond,
      waveformStepX,
      waveformLoudColumns,
      canvasWidthPx: canvas.width,
    };
  }, {
    tickIndex: ALIGNMENT_TICK_INDEX,
    timeSecs: ALIGNMENT_TIME_SECS,
    clipSpanSecs: CLIP_SPAN_SECS,
    loudFillRatio: LOUD_COLUMN_MIN_FILL_RATIO,
  });
}

// The shared body every zoom-state test runs: reads all six surfaces' geometry,
// gates that the measurement itself is trustworthy, then asserts every surface
// resolves ALIGNMENT_TIME_SECS to the same x as the ruler tick (the reference).
async function assertSixSurfacesAlign(label: string): Promise<void> {
  const g = await readSixSurfaceGeometry();

  expect(g.scrollOffsetPx, `[${label}] shell scroll offset should be 0 — this spec never pans`).toBe(0);
  expect(
    Math.abs(g.tickPxPerSecond - TIMELINE_PX_PER_SECOND),
    `[${label}] measured ruler px/s ${g.tickPxPerSecond} drifted from DAW_TIMELINE_PX_PER_SECOND ${TIMELINE_PX_PER_SECOND}`,
  ).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
  expect(
    Math.abs(g.gridPxPerSecond - g.tickPxPerSecond),
    `[${label}] lane gridline px/s ${g.gridPxPerSecond} disagrees with ruler tick px/s ${g.tickPxPerSecond}`,
  ).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
  expect(
    Math.abs(g.clipPxPerSecond - g.tickPxPerSecond),
    `[${label}] take clip px/s ${g.clipPxPerSecond} disagrees with ruler tick px/s ${g.tickPxPerSecond}`,
  ).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
  expect(
    g.waveformLoudColumns,
    `[${label}] waveform column scan found no loud columns — the step-detection gate is unreliable`,
  ).toBeGreaterThan(0);
  expect(
    g.waveformLoudColumns,
    `[${label}] waveform column scan found an all-loud canvas — the step-detection gate is unreliable`,
  ).toBeLessThan(g.canvasWidthPx);

  const expectAligned = (surface: string, x: number) => {
    expect(
      Math.abs(x - g.tickAtX),
      `[${label}] ${surface} is ${x}px at t=${ALIGNMENT_TIME_SECS}s, ruler tick is ${g.tickAtX}px`,
    ).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  };

  // (1) ruler tick — g.tickAtX is the reference itself.
  // (2) lane gridline.
  expectAligned('lane gridline', g.gridAtX);
  // (3) take clip — the clip's own origin and its own measured scale.
  expectAligned('take clip', g.clipLeftX + ALIGNMENT_TIME_SECS * g.clipPxPerSecond);
  // (4) waveform column step.
  expectAligned('waveform column step', g.waveformStepX);

  // (5) scrub target.
  const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
  // Rounded because Chromium delivers integral clientX; the residual <=0.5px is
  // inside the tolerance.
  const scrubTargetX = Math.round(g.tickZeroX + ALIGNMENT_TIME_SECS * g.tickPxPerSecond);
  expectAligned('scrub target', scrubTargetX);

  await window.mouse.move(scrubTargetX, rulerBox.y + rulerBox.height / 2);
  await window.mouse.down();

  // (6) playhead — read both segments while the scrub is held.
  const playheadLaneX = (await window.locator('.daw-playhead-lanes').boundingBox())!.x;
  const playheadRulerX = (await window.locator('.daw-playhead-ruler').boundingBox())!.x;
  expectAligned('lane playhead', playheadLaneX);
  expectAligned('ruler playhead', playheadRulerX);

  // Commit the scrub and prove the target means ten seconds, not just this many
  // pixels.
  await window.mouse.up();
  const seek = (await electronApp.evaluate(
    () => (globalThis as Record<string, unknown>).__alignmentSeek,
  )) as { startOffsetSecs?: number } | null;
  expect(seek, `[${label}] releasing the scrub did not commit a seek`).not.toBeNull();
  expect(
    Math.abs((seek!.startOffsetSecs ?? NaN) - ALIGNMENT_TIME_SECS),
    `[${label}] committed seek ${seek!.startOffsetSecs}s should be ${ALIGNMENT_TIME_SECS}s`,
  ).toBeLessThanOrEqual(SEEK_TOLERANCE_SECS);
}

async function setScaleState(
  state: string,
  fit?: { durationSecs: number; viewportWidthPx: number },
): Promise<TimelineScaleSnapshot> {
  return window.evaluate(
    ({ state, fit }) => window.__soundBuddyTimelineScale!.setState(state, fit),
    { state, fit },
  );
}

// Derives the fit inputs from the running app rather than hardcoding them, so the
// 'fit' case stays honest about what "fit the loaded take into the timeline column"
// means: durationSecs from the clip's own measured geometry, viewportWidthPx from the
// timeline column's own measured width.
async function fitRequestFromDom(): Promise<{ durationSecs: number; viewportWidthPx: number }> {
  const g = await readSixSurfaceGeometry();
  const durationSecs = (g.clipRightX - g.clipLeftX) / g.clipPxPerSecond;
  const viewportWidthPx = (await window.locator('.daw-timeline').boundingBox())!.width;
  return { durationSecs, viewportWidthPx };
}

test.describe('Session timeline alignment across zoom states (#1297)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp({ SOUND_BUDDY_TEST_HOOKS: '1' }));
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
        tracks: [{
          index: 0,
          kind: 'mono',
          bucketCount: LOUD_BUCKETS + SILENT_BUCKETS,
          data: steppedPeaks(LOUD_BUCKETS, SILENT_BUCKETS),
        }],
      },
    });
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await stopCaptureIfRunning(window);

    // The test hook is re-installed on every reload; wait for it before touching it.
    await expect
      .poll(() => window.evaluate(() => '__soundBuddyTimelineScale' in window), { timeout: HOOK_READY_TIMEOUT_MS })
      .toBe(true);

    await window.locator('.mode-tab[data-mode="live"]').click();
    // Seed channelConfig: liveCaptureStore.loadDevices() is only reachable from the
    // Settings -> Audio refresh button, and window.reload() clears the store — without
    // this there are no lanes and no gridlines. Same dance as timeline-alignment.spec.ts.
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#device-refresh-btn').click();
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('.daw-channel-lane')).toHaveCount(2);
    // A monitor session may have started while devices were seeded; the rAF playhead
    // loop only runs while capturing and would repaint over the scrub preview.
    await stopCaptureIfRunning(window);

    await window.locator('.daw-session-picker-select').selectOption({ label: 'open session folder…' });
    await expect(window.locator('#daw-session-play')).toBeEnabled();
    await expect(window.locator('.daw-take-clip')).toHaveCount(1);

    // Start each test from a known scale state.
    await window.evaluate(() => window.__soundBuddyTimelineScale!.reset());
  });

  for (const state of TIMELINE_SCALE_STATES) {
    test(`all six timeline surfaces resolve ${ALIGNMENT_TIME_SECS}s to one x in the "${state}" scale state (#1297)`, async () => {
      const fit = state === 'fit' ? await fitRequestFromDom() : undefined;
      const snapshot = await setScaleState(state, fit);
      // Load-bearing: proves the hook really reached the requested state, so this
      // case is not silently re-running the default one.
      expect(snapshot.state).toBe(state);
      expect(Number.isFinite(snapshot.pxPerSecond)).toBe(true);
      expect(snapshot.pxPerSecond).toBeGreaterThan(0);
      if (state === 'fit') {
        const expected = Math.min(
          SCALE_MAX_PX_PER_SECOND,
          Math.max(SCALE_MIN_PX_PER_SECOND, fit!.viewportWidthPx / fit!.durationSecs),
        );
        expect(Math.abs(snapshot.pxPerSecond - expected)).toBeLessThanOrEqual(FIT_SCALE_TOLERANCE_PX_PER_SECOND);
      }
      await assertSixSurfacesAlign(state);
    });
  }

  test('the four zoom states are distinguishable in the shared scale model (#1297)', async () => {
    const pxPerSecondFor = async (state: string): Promise<number> => {
      const fit = state === 'fit' ? await fitRequestFromDom() : undefined;
      const snapshot = await setScaleState(state, fit);
      return snapshot.pxPerSecond;
    };

    const zoomedIn = await pxPerSecondFor('zoomed-in');
    const defaultScale = await pxPerSecondFor('default');
    const zoomedOut = await pxPerSecondFor('zoomed-out');

    for (const value of [zoomedIn, defaultScale, zoomedOut]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(zoomedIn).toBeGreaterThan(defaultScale);
    expect(defaultScale).toBeGreaterThan(zoomedOut);
  });
});
