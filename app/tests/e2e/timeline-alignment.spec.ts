import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, stopCaptureIfRunning } from './e2e-helpers';

// #1325/#1326: the Session arrangement paints five independent time-positioned surfaces —
// ruler ticks, lane gridlines, the cached take clip, the scrub gesture's
// pointer-to-time mapping, and the playhead — and every one of them is supposed to
// resolve a given timestamp to the same shell-local x through the one shared geometry
// (ADR-0086's dawTimelineX origin + px-per-second, re-based by ADR-0090's single CSS
// translate). This spec proves that invariant in a running app by reading real DOM/canvas
// geometry (bounding boxes, computed style, and the pointer coordinates this test itself
// dispatches) — never screenshots — and asserting all five x-positions agree within a
// named pixel tolerance, both at the default scale and after a toolbar zoom-in, zoom-out,
// fit-full, a horizontal wheel pan, and a window resize (#1326, which also landed the fix
// that makes the ruler/lane scrub scroll-aware). It is IPC-stubbed (open-dir-dialog,
// generate-session-peaks, list-output-devices, start-playback), so it needs no
// sox/ffprobe/python and no packaged .app, and is deliberately NOT added to
// playwright.config.ts's MEDIA_SPECS. Playback and live-recording coverage of the same
// invariant landed here in #1327: the playback playhead is pinned by 'playback-event'
// progress ticks (no clock involved), while the wall-clock record head is sampled through a
// synchronous renderPlayhead() repaint so the paint and the clock read share one instant.
// Follow-scroll pause/resume coverage landed here in #1328: pause is observed on
// #daw-follow-toggle's aria-pressed and title (the only DOM the follow model reaches), and
// "stops auto-tracking" is observed as the manually-set viewport (--daw-scroll-x and
// #daw-zoom-range) staying pinned while the playhead walks past its visible range's right
// edge on a progress tick. Viewport auto-tracking itself — timelineFollowRange() actually
// paging the visible range toward the playhead — has no production caller yet in this
// checkout; ADR-0111 splits that wiring out to #1283, which is parked. Loop-brace and
// time-selection coverage landed here in #1329: the brace's edges are read at the default
// seeded 0..10s loop range after switching Loop on, the band's edges are read after a real
// ruler drag, both are compared against the ruler tick AND the lane gridline at the same
// timestamps, and each case probes the running build and calls test.skip(...) with a named
// reason when its feature is absent, so an unshipped feature is reported as pending rather
// than missing.

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
// One pixel's worth of seconds is the committed-seek epsilon; #1342 derives it from the
// MEASURED px-per-second (ALIGNMENT_TOLERANCE_PX / measuredPxPerSecond) inside the helper,
// since a zoomed-in scale means one pixel is fewer seconds — so no fixed constant here.
// ADR-0014's peaks document: 50 buckets/sec, one interleaved min/max u8 pair per bucket.
// 500 buckets => the take clip spans exactly ALIGNMENT_TIME_SECS, so its RIGHT edge is the
// 10s tick. Track 0 of tests/fixtures/session/session.json is mono sourceChannels [0],
// which claims exactly one of the two default mono strips (a=0, a=1) seeded by
// liveCaptureStore's defaultChannelConfig.
const PEAKS_BUCKETS_PER_SECOND = 50;
const PEAK_BUCKETS = ALIGNMENT_TIME_SECS * PEAKS_BUCKETS_PER_SECOND; // 500

// 5 seconds of pan at the default scale (8px/s) — small enough that the 10s position
// (80px from t=0) stays inside the timeline column after a zoom-in narrows the visible
// range to [0, 30].
const SCROLL_DELTA_PX = 40;
// Narrow enough to force the toolbar into its compact layout's reflow, wide enough that
// the timeline column still has room to paint all five surfaces under test.
const RESIZED_WIDTH_PX = 1000;

// The default loop range #1314 seeds on the first Loop switch-on. Mirrors
// DEFAULT_LOOP_START_SECS / DEFAULT_LOOP_LENGTH_SECS in renderer/src/loopBrace.render.ts.
const LOOP_DEFAULT_START_SECS = 0;
const LOOP_DEFAULT_END_SECS = 10;
const LOOP_START_TICK_INDEX = LOOP_DEFAULT_START_SECS / RULER_TICK_INTERVAL_SECS; // 0
const LOOP_END_TICK_INDEX = LOOP_DEFAULT_END_SECS / RULER_TICK_INTERVAL_SECS;     // 2

// The range the time-selection case drags. Both endpoints are multiples of
// RULER_TICK_INTERVAL_SECS (so a ruler tick and a lane gridline exist at each), and the
// 40px span is an order of magnitude past TIME_SELECTION_DRAG_THRESHOLD_PX (4px) in
// renderer/src/time-selection-drag.ts, so the press is unambiguously a drag, not a click.
const SELECTION_START_SECS = 5;
const SELECTION_END_SECS = 10;
const SELECTION_START_TICK_INDEX = SELECTION_START_SECS / RULER_TICK_INTERVAL_SECS; // 1
const SELECTION_END_TICK_INDEX = SELECTION_END_SECS / RULER_TICK_INTERVAL_SECS;     // 2
// Intermediate pointer moves, so the gesture crosses the threshold through real
// pointermove events rather than one teleport.
const SELECTION_DRAG_STEPS = 10;
// Bounded wait for a capability probe. Short on purpose: a present feature attaches its
// node on the same turn as the click, and an ABSENT one must not cost a 5s timeout.
const FEATURE_PROBE_TIMEOUT_MS = 2000;

// The three timestamps the playback case samples at. All multiples of both
// RULER_TICK_INTERVAL_SECS and the lane grid's 5s minor division, so a ruler tick and a
// gridline exist at each one; the transport text is the per-sample synchronisation gate
// (the soundcheck transport controller coalesces progress ticks onto a rAF).
const PLAYBACK_SAMPLES = [
  { secs: 5, transport: '0:05' },
  { secs: 10, transport: '0:10' },
  { secs: 15, transport: '0:15' },
];
// Reported on every progress tick. Larger than the last sample so no sample is a
// past-the-end position; the fixture's own 1s stems are irrelevant here because playback is
// stubbed and the clip's painted span comes from the peaks document.
const PLAYBACK_DURATION_SECS = 20;
// How many points the recording case samples, and the real time between them. 700ms is
// 5.6px of record-head travel at TIMELINE_PX_PER_SECOND — comfortably above
// RECORD_HEAD_MIN_ADVANCE_PX, so "the head moved" is never a rounding artifact.
const RECORD_SAMPLE_COUNT = 3;
const RECORD_SAMPLE_INTERVAL_MS = 700;
// The floor for per-sample record-head travel. Deliberately far below the 5.6px expected at
// RECORD_SAMPLE_INTERVAL_MS: scheduling delay can only make the real travel larger, so this
// proves the head is advancing without pinning the test to the machine's timing.
const RECORD_HEAD_MIN_ADVANCE_PX = 2;
// The take clip's painted span, from the PEAK_BUCKETS fixture above: 500 buckets at
// PEAKS_BUCKETS_PER_SECOND is exactly ALIGNMENT_TIME_SECS of arrangement time.
const CLIP_SPAN_SECS = ALIGNMENT_TIME_SECS;

// The follow-scroll toggle's two title/aria-label strings, copied verbatim from
// timelineFollowView() in renderer/src/timeline-follow-scroll.ts. Asserting the title as well
// as aria-pressed proves the toolbar re-rendered from the follow MODEL, not just an attribute.
const FOLLOW_FOLLOWING_TITLE = 'Following the playhead - click to pause';
const FOLLOW_PAUSED_TITLE = 'Follow paused - click to follow the playhead again';
// A ctrl-modified wheel is how Chromium delivers a macOS trackpad pinch, and is the only
// gesture timelineFollowEventForWheel maps to 'manual-zoom'. -240px is ~3x span narrowing at
// TIMELINE_ZOOM_WHEEL_RATE — comfortably inside TIMELINE_ZOOM_MAX_STEP_FACTOR, so one event
// visibly moves #daw-zoom-range from the full range.
const FOLLOW_ZOOM_WHEEL_DELTA_Y = -240;
// The duration the follow cases report on every progress tick, matching the fixed 60s full
// timeline (TIMELINE_OVERVIEW_MIN_DURATION_SECS) the zoom model normalizes against.
const FOLLOW_PLAYBACK_DURATION_SECS = 60;
// A playhead position past the right edge of every visible range these cases produce
// ([0,30] after a zoom-in + pan, [0,~18] after a zoom wheel), so the tick genuinely asks the
// view to track something off-screen.
const FOLLOW_BEYOND_RANGE_SECS = 50;
const FOLLOW_BEYOND_RANGE_TRANSPORT = '0:50';

// Full-height min/max pairs (level 0 -> -1, level 255 -> +1, ADR-0004 quantization),
// mirroring daw-shell.spec.ts's helper of the same name.
function fullHeightPeaks(buckets: number): string {
  const levels: number[] = [];
  for (let i = 0; i < buckets; i++) levels.push(0, 255);
  return Buffer.from(levels).toString('base64');
}

// Reads --daw-scroll-x off the shell and re-derives every expected painted x from it, so
// a case that pans the visible range asserts against the offset the app actually applied
// rather than a number this test hardcoded. Returns the offset so a caller can prove its
// interaction really moved the range.
// The painted pixels-per-second, measured straight off the ruler ticks (#1342): the ruler
// tick at ALIGNMENT_TIME_SECS minus the t=0 tick, over ALIGNMENT_TIME_SECS. This is the
// production scale the shell actually renders at, so a change here proves a zoom control
// drove the paint, not just the model.
async function measurePaintedPxPerSecond(): Promise<number> {
  const ticks = window.locator('.daw-ruler .daw-ruler-tick');
  const tick0 = (await ticks.nth(0).boundingBox())!;
  const tickAt = (await ticks.nth(ALIGNMENT_TICK_INDEX).boundingBox())!;
  return (tickAt.x - tick0.x) / ALIGNMENT_TIME_SECS;
}

// #1342 wired the toolbar zoom state into the painted scale, so px-per-second is no
// longer a fixed 8 after a zoom: this helper MEASURES it from the ruler ticks and derives
// every expected x from the measured value, so it stays honest at any zoom. A caller that
// wants to pin the scale (the default-scale case) passes expectedPxPerSecond; the zoom
// cases omit it and assert only that all six surfaces agree at whatever scale is painted.
async function assertFiveSurfacesAlignAt10s(expectedPxPerSecond?: number): Promise<number> {
  const shell = window.locator('.daw-shell');
  const scrollOffsetPx = parseFloat(await shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim()));
  expect(Number.isFinite(scrollOffsetPx)).toBe(true);

  const ticks = window.locator('.daw-ruler .daw-ruler-tick');
  const tick0 = (await ticks.nth(0).boundingBox())!;
  const tickAt = (await ticks.nth(ALIGNMENT_TICK_INDEX).boundingBox())!;
  const measuredPxPerSecond = (tickAt.x - tick0.x) / ALIGNMENT_TIME_SECS;
  expect(measuredPxPerSecond).toBeGreaterThan(0);
  if (expectedPxPerSecond !== undefined) {
    expect(Math.abs(measuredPxPerSecond - expectedPxPerSecond))
      .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
  }

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
  // beginSessionTimelineScrub measures from the pressed surface's own left edge re-based by
  // the visible range's scroll offset (scrubTimelineLeftPx, #1326), which is the shared t=0
  // edge at any pan. Derived from the MEASURED scale so it stays correct after a zoom (#1342).
  const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
  // Rounded because Chromium delivers integral clientX to the page; the residual <=0.5px
  // is absorbed by ALIGNMENT_TOLERANCE_PX.
  const scrubTargetX = Math.round(rulerBox.x + ALIGNMENT_TIME_SECS * measuredPxPerSecond - scrollOffsetPx);

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
  // One pixel's worth of seconds is the epsilon, at the scale actually painted (#1342).
  await window.mouse.up();
  const seek = (await electronApp.evaluate(
    () => (globalThis as Record<string, unknown>).__alignmentSeek,
  )) as { startOffsetSecs?: number } | null;
  expect(seek).not.toBeNull();
  expect(Math.abs((seek!.startOffsetSecs ?? NaN) - ALIGNMENT_TIME_SECS))
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / measuredPxPerSecond);

  return scrollOffsetPx;
}

// One reading of the two reference surfaces at a given ruler tick index, plus the
// px-per-second each was measured at, so every expected x below is derived from the app's
// own geometry instead of a hardcoded pixel value.
interface RulerGridReadings {
  timeSecs: number;
  tickX: number;
  gridX: number;
  pxPerSecond: number;
}

async function readRulerAndGridAt(tickIndex: number): Promise<RulerGridReadings> {
  const ticks = window.locator('.daw-ruler .daw-ruler-tick');
  const gridlines = window.locator('.daw-channel-lane[data-ch="0"] .daw-lane-grid .daw-gridline');
  expect(await ticks.count()).toBeGreaterThan(tickIndex);
  expect(await gridlines.count()).toBeGreaterThan(tickIndex);

  // px-per-second is always measured from index 0 vs ALIGNMENT_TICK_INDEX (10s) regardless
  // of which tickIndex is being read, so tickIndex === 0 does not divide by zero.
  const tick0Box = (await ticks.nth(0).boundingBox())!;
  const tickRefBox = (await ticks.nth(ALIGNMENT_TICK_INDEX).boundingBox())!;
  const grid0Box = (await gridlines.nth(0).boundingBox())!;
  const gridRefBox = (await gridlines.nth(ALIGNMENT_TICK_INDEX).boundingBox())!;
  const tickPxPerSecond = (tickRefBox.x - tick0Box.x) / ALIGNMENT_TIME_SECS;
  const gridPxPerSecond = (gridRefBox.x - grid0Box.x) / ALIGNMENT_TIME_SECS;
  expect(Math.abs(tickPxPerSecond - TIMELINE_PX_PER_SECOND))
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
  expect(Math.abs(gridPxPerSecond - TIMELINE_PX_PER_SECOND))
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);

  const tickAtBox = (await ticks.nth(tickIndex).boundingBox())!;
  const gridAtBox = (await gridlines.nth(tickIndex).boundingBox())!;
  expect(Math.abs(gridAtBox.x - tickAtBox.x)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);

  const timeSecs = tickIndex * RULER_TICK_INTERVAL_SECS;
  return { timeSecs, tickX: tickAtBox.x, gridX: gridAtBox.x, pxPerSecond: tickPxPerSecond };
}

// Asserts one painted edge sits on BOTH reference surfaces at the same timestamp.
function expectEdgeAligned(label: string, x: number, reference: RulerGridReadings): void {
  expect(Math.abs(x - reference.tickX), `${label}: ${x}px vs ruler tick ${reference.tickX}px at ${reference.timeSecs}s`)
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  expect(Math.abs(x - reference.gridX), `${label}: ${x}px vs lane gridline ${reference.gridX}px at ${reference.timeSecs}s`)
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
}

// Capability probe for the loop brace. Clicks the Session toolbar's Loop button when it
// exists and reports whether a brace actually attached, so "the feature is not in this
// build" is answered by the build, not by a hand-maintained flag.
async function enableLoopBraceIfPresent(): Promise<boolean> {
  const toggle = window.locator('#daw-session-loop');
  if (await toggle.count() === 0) return false;
  await toggle.click();
  const brace = window.locator('.daw-loop-brace');
  await brace.waitFor({ state: 'attached', timeout: FEATURE_PROBE_TIMEOUT_MS }).catch(() => {});
  return await brace.count() > 0;
}

// Drags the ruler from fromSecs to toSecs with real pointer input, so the gesture goes
// through the production route (LiveCapturePanel's pointerdown -> beginTimeSelectionDrag).
// clientX is rounded because Chromium delivers integral coordinates; the residual <=0.5px
// is inside ALIGNMENT_TOLERANCE_PX. Re-bases by --daw-scroll-x exactly like the existing
// scrubTargetX computation in assertFiveSurfacesAlignAt10s.
async function dragRulerSelection(fromSecs: number, toSecs: number): Promise<void> {
  const shell = window.locator('.daw-shell');
  const scrollOffsetPx = parseFloat(await shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim()));
  const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
  const y = rulerBox.y + rulerBox.height / 2;
  const xAt = (secs: number) => Math.round(rulerBox.x + secs * TIMELINE_PX_PER_SECOND - scrollOffsetPx);

  await window.mouse.move(xAt(fromSecs), y);
  await window.mouse.down();
  await window.mouse.move(xAt(toSecs), y, { steps: SELECTION_DRAG_STEPS });
  await window.mouse.up();
}

// One atomic reading of every time-positioned surface under test, plus the wall-clock
// playhead time and the shell's scroll offset. Every x is a viewport bounding-box x, so
// the shared ADR-0090 translate cancels out of every comparison.
interface TimelineGeometrySample {
  // dawPlayheadState's wall-clock elapsed, in seconds. 0 unless a recording is running.
  playheadElapsedSecs: number;
  laneHeadX: number;
  rulerHeadX: number;
  laneHeadAdvancing: boolean;
  tickZeroX: number;
  tickPxPerSecond: number;
  gridZeroX: number;
  gridPxPerSecond: number;
  // NaN when no take clip is painted (the recording case).
  clipZeroX: number;
  clipPxPerSecond: number;
  scrollOffsetPx: number;
}

// The renderer bridge App.tsx installs on window (#1301) — a structural cast, not `any`.
type DawShellRuntimeBridge = { renderPlayhead(): void; playheadElapsedMs(): number };

async function sampleTimelineGeometry(repaint: boolean): Promise<TimelineGeometrySample> {
  return window.evaluate(
    ({ repaint, tickIndex, timeSecs, clipSpanSecs }) => {
      const runtime = (window as unknown as { dawShellRuntime: DawShellRuntimeBridge }).dawShellRuntime;
      // The FIRST statement: writes style.left onto every .daw-playhead segment synchronously,
      // the same painter LiveWorkspace's applyLiveTick and the soundcheck transport
      // controller call. The getBoundingClientRect() reads below force layout in this same
      // turn, and playheadElapsedMs() is read in this same turn too, so the paint and the
      // clock read share one Date.now() — the whole reason the recording case can use a
      // 1px tolerance despite the head being wall-clock driven.
      if (repaint) runtime.renderPlayhead();
      const playheadElapsedSecs = runtime.playheadElapsedMs() / 1000;

      const shell = document.querySelector('.daw-shell') as HTMLElement;
      const scrollOffsetPx = parseFloat(getComputedStyle(shell).getPropertyValue('--daw-scroll-x'));

      const ticks = Array.from(document.querySelectorAll('.daw-ruler .daw-ruler-tick'));
      const tick0Box = ticks[0].getBoundingClientRect();
      const tickAtBox = ticks[tickIndex].getBoundingClientRect();
      const tickZeroX = tick0Box.x;
      const tickPxPerSecond = (tickAtBox.x - tick0Box.x) / timeSecs;

      const gridlines = Array.from(
        document.querySelectorAll('.daw-channel-lane[data-ch="0"] .daw-lane-grid .daw-gridline'),
      );
      const grid0Box = gridlines[0].getBoundingClientRect();
      const gridAtBox = gridlines[tickIndex].getBoundingClientRect();
      const gridZeroX = grid0Box.x;
      const gridPxPerSecond = (gridAtBox.x - grid0Box.x) / timeSecs;

      const clipEl = document.querySelector('.daw-channel-lane[data-ch="0"] .daw-take-clip');
      const clipBox = clipEl ? clipEl.getBoundingClientRect() : null;
      const clipZeroX = clipBox ? clipBox.x : NaN;
      const clipPxPerSecond = clipBox ? clipBox.width / clipSpanSecs : NaN;

      const laneHead = document.querySelector('.daw-playhead-lanes') as HTMLElement;
      const rulerHead = document.querySelector('.daw-playhead-ruler') as HTMLElement;

      return {
        playheadElapsedSecs,
        laneHeadX: laneHead.getBoundingClientRect().x,
        rulerHeadX: rulerHead.getBoundingClientRect().x,
        laneHeadAdvancing: laneHead.classList.contains('advancing'),
        tickZeroX,
        tickPxPerSecond,
        gridZeroX,
        gridPxPerSecond,
        clipZeroX,
        clipPxPerSecond,
        scrollOffsetPx,
      };
    },
    { repaint, tickIndex: ALIGNMENT_TICK_INDEX, timeSecs: ALIGNMENT_TIME_SECS, clipSpanSecs: CLIP_SPAN_SECS },
  );
}

// Pure: asserts a sample's surfaces all resolve timeSecs to the same x. No hardcoded pixel
// value — every expected x is derived from the sample's own measured ruler/gridline/clip
// origin and px-per-second, so a future change to DAW_TIMELINE_PX_PER_SECOND or
// DAW_TIMELINE_ORIGIN_PX cannot make this pass for the wrong reason or fail spuriously.
function expectHeadTracksTimelineAt(sample: TimelineGeometrySample, timeSecs: number, label: string): void {
  expect(Math.abs(sample.tickPxPerSecond - TIMELINE_PX_PER_SECOND))
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
  expect(Math.abs(sample.gridPxPerSecond - TIMELINE_PX_PER_SECOND))
    .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);

  expect(Math.abs(sample.gridZeroX - sample.tickZeroX)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  if (Number.isFinite(sample.clipZeroX)) {
    expect(Math.abs(sample.clipZeroX - sample.tickZeroX)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  }

  const rulerX = sample.tickZeroX + timeSecs * sample.tickPxPerSecond;
  const gridX = sample.gridZeroX + timeSecs * sample.gridPxPerSecond;
  // Past the clip's right edge this extrapolates the clip's OWN scale — that scale agreeing
  // with the ruler's is precisely the invariant under test.
  const clipX = Number.isFinite(sample.clipZeroX) ? sample.clipZeroX + timeSecs * sample.clipPxPerSecond : NaN;

  const expectAligned = (surfaceLabel: string, x: number, reference: number) => {
    expect(Math.abs(x - reference), `${label}: ${surfaceLabel} is ${x}px, expected ${reference}px`)
      .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
  };
  expectAligned('lane playhead vs ruler tick', sample.laneHeadX, rulerX);
  expectAligned('ruler playhead vs ruler tick', sample.rulerHeadX, rulerX);
  expectAligned('lane playhead vs lane gridline', sample.laneHeadX, gridX);
  if (Number.isFinite(clipX)) {
    expectAligned('lane playhead vs take clip', sample.laneHeadX, clipX);
  }

  expect(sample.scrollOffsetPx).toBe(0);
}

// Mirrors sendPlaybackEvent/sendLiveEvent in session-tab-playback.e2e.spec.ts.
async function sendPlaybackProgress(elapsedSecs: number, durationSecs: number = PLAYBACK_DURATION_SECS): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, evt) => {
    BrowserWindow.getAllWindows()[0].webContents.send('playback-event', evt);
  }, { type: 'progress', elapsed: elapsedSecs, duration: durationSecs });
}

async function sendPlaybackEnded(): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, evt) => {
    BrowserWindow.getAllWindows()[0].webContents.send('playback-event', evt);
  }, { type: 'ended' });
}

async function sendLiveMeterTick(): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, evt) => {
    BrowserWindow.getAllWindows()[0].webContents.send('live-event', evt);
  }, { type: 'meter', channels: [{ rms: -18, peak: -6 }] });
}

// The observable form of "follow stopped auto-tracking the playhead" in THIS checkout.
// timelineFollowRange() — the pure function that would page the visible range after the
// playhead — has no production caller: ADR-0111 split the policy (#1286, landed) from the
// viewport wiring (#1283, parked), so no range in the app chases the playhead yet, in either
// follow state. Asserting "following moves the range" would therefore fail against correct
// code. What IS assertable, and is exactly the contract #1283 must not break, is that a
// paused follow leaves the range the user set alone while the playhead walks off the right
// edge of it: --daw-scroll-x and the #daw-zoom-range readout are byte-identical before and
// after a progress tick at FOLLOW_BEYOND_RANGE_SECS, and the toggle is still paused.
async function expectViewportPinnedWhilePaused(label: string): Promise<void> {
  const shell = window.locator('.daw-shell');
  const scrollBefore = await shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim());
  const rangeBefore = await window.locator('#daw-zoom-range').textContent();

  await sendPlaybackProgress(FOLLOW_BEYOND_RANGE_SECS, FOLLOW_PLAYBACK_DURATION_SECS);
  // The synchronisation gate: the transport text is patched by the same rAF repaint that
  // moves the playhead, so once it reads 0:50 the playhead is past the visible range's end.
  await expect(window.locator('.daw-transport-time')).toHaveText(FOLLOW_BEYOND_RANGE_TRANSPORT);

  expect(await shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim()), `${label}: scroll offset moved while follow was paused`).toBe(scrollBefore);
  expect(await window.locator('#daw-zoom-range').textContent(), `${label}: visible range moved while follow was paused`).toBe(rangeBefore);
  await expect(window.locator('#daw-follow-toggle')).toHaveAttribute('aria-pressed', 'false');
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
    // Pin "default scale, no scroll" (geometry, not a screenshot) before delegating to the
    // shared helper, which proves the local TIMELINE_PX_PER_SECOND/RULER_TICK_INTERVAL_SECS
    // constants above have not drifted from the renderer's
    // DAW_TIMELINE_PX_PER_SECOND/DAW_RULER_TICK_INTERVAL_SECS.
    const shell = window.locator('.daw-shell');
    expect(await shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim())).toBe('0px');
    // Pin px-per-second at the base scale: at the boot full range the painted scale is
    // provably DAW_TIMELINE_PX_PER_SECOND (#1342, sessionTimelineScalePxPerSecond), which
    // also guards the local TIMELINE_PX_PER_SECOND constant against drift.
    expect(await assertFiveSurfacesAlignAt10s(TIMELINE_PX_PER_SECOND)).toBe(0);
  });

  // #1342 fixed the boot-pinned zoom model: LiveCapturePanel now seeds `timelineZoom` from
  // the timeline's real (floored) duration and re-derives it to the loaded session's full
  // range on load, so `#daw-zoom-in` is available immediately (AC1) and `#daw-zoom-fit`
  // boots DISABLED (the range already spans the full timeline). The cases below therefore no
  // longer click `#daw-zoom-fit` first to unstick the model — the pre-#1342 workaround the
  // frozen #1326 plan needed — and, because a zoom now changes the painted scale (AC2),
  // assertFiveSurfacesAlignAt10s() measures px-per-second from the DOM instead of pinning 8.
  test('alignment holds after a toolbar zoom-in (#1326/#1342)', async () => {
    const rangeReadout = window.locator('#daw-zoom-range');
    const before = await rangeReadout.textContent();
    // The painted scale is the base scale at the boot full range.
    expect(Math.abs(await measurePaintedPxPerSecond() - TIMELINE_PX_PER_SECOND))
      .toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX / ALIGNMENT_TIME_SECS);
    await window.locator('#daw-zoom-in').click();
    await expect.poll(() => rangeReadout.textContent()).not.toBe(before);
    // Load-bearing for #1342 AC2: zoom-in must magnify the PAINTED scale, not only pan —
    // the ruler ticks are now measurably further apart than the base scale.
    expect(await measurePaintedPxPerSecond()).toBeGreaterThan(TIMELINE_PX_PER_SECOND + 1);
    expect(await assertFiveSurfacesAlignAt10s()).toBe(0);
  });

  test('alignment holds after a toolbar zoom-out (#1326/#1342)', async () => {
    await window.locator('#daw-zoom-in').click();
    await expect(window.locator('#daw-zoom-out')).toBeEnabled();
    await window.locator('#daw-zoom-out').click();
    expect(await assertFiveSurfacesAlignAt10s()).toBe(0);
  });

  test('alignment holds after fit-full (#1326/#1342)', async () => {
    // Zoom in to leave the full range (so #daw-zoom-fit re-enables), then fit-full is the
    // control under test: it returns to the full range and disables itself again.
    await window.locator('#daw-zoom-in').click();
    await expect(window.locator('#daw-zoom-fit')).toBeEnabled();
    await window.locator('#daw-zoom-fit').click();
    await expect(window.locator('#daw-zoom-fit')).toBeDisabled();
    // Back at the full range, the painted scale is the base scale again (#1342).
    expect(await assertFiveSurfacesAlignAt10s(TIMELINE_PX_PER_SECOND)).toBe(0);
  });

  test('alignment holds after a horizontal scroll (#1326/#1342)', async () => {
    // Zoom in first so the visible range narrows and the pan below has room to move.
    await window.locator('#daw-zoom-in').click();
    await expect(window.locator('#daw-zoom-out')).toBeEnabled();

    const ruler = window.locator('.daw-ruler');
    const rulerBox = (await ruler.boundingBox())!;
    await window.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
    await window.mouse.wheel(SCROLL_DELTA_PX, 0);

    const shell = window.locator('.daw-shell');
    await expect.poll(() => shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim())).not.toBe('0px');

    // Load-bearing: proves this case is not silently re-running the default-scale assertion.
    const offset = await assertFiveSurfacesAlignAt10s();
    expect(offset).toBeGreaterThan(0);
  });

  test('alignment holds after a window resize (#1326)', async () => {
    const originalSize = (await electronApp.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize(),
    )) as [number, number];

    try {
      await electronApp.evaluate(({ BrowserWindow }, [w, h]) => {
        BrowserWindow.getAllWindows()[0].setSize(w, h);
      }, [RESIZED_WIDTH_PX, originalSize[1]] as [number, number]);
      await window.waitForFunction((w) => window.innerWidth <= w, RESIZED_WIDTH_PX);

      expect(await assertFiveSurfacesAlignAt10s()).toBe(0);
    } finally {
      await electronApp.evaluate(({ BrowserWindow }, [w, h]) => {
        BrowserWindow.getAllWindows()[0].setSize(w, h);
      }, originalSize);
      await window.waitForFunction((w) => window.innerWidth >= w, originalSize[0]);
    }
  });

  test('ruler tick, lane gridline, take clip and the playhead share one x at multiple timestamps during loaded-take playback (#1327)', async () => {
    // Load-bearing: soundcheckStore's playback-event handler drops progress ticks unless
    // playing is true. start-playback is already stubbed in the shared beforeEach.
    await window.locator('#daw-session-play').click();
    await expect(window.locator('#daw-session-stop')).toBeVisible();

    for (const { secs, transport } of PLAYBACK_SAMPLES) {
      await sendPlaybackProgress(secs);
      // The synchronisation gate for the rAF-coalesced transport controller repaint.
      await expect(window.locator('.daw-transport-time')).toHaveText(transport);
      // No repaint: this path is already deterministic (the head's x is a pure function of
      // the last progress tick), so the test measures exactly what the production painter
      // left on screen.
      const sample = await sampleTimelineGeometry(false);
      // Proves the PLAYBACK path painted this, not a stray wall-clock record head.
      expect(sample.playheadElapsedSecs).toBe(0);
      expectHeadTracksTimelineAt(sample, secs, `playback t=${secs}s`);
      expect(sample.laneHeadAdvancing).toBe(true);
    }

    await sendPlaybackEnded();
    await expect(window.locator('#daw-session-play')).toBeVisible();
  });

  test('follow-scroll pauses on a manual horizontal scroll and leaves the viewport pinned (#1328)', async () => {
    // Narrow the range so a pan has somewhere to go (#1342 boots at the full range, so no
    // Fit-click is needed first). Zoom-in fires 'navigate', so follow is provably ON before
    // the gesture under test.
    await window.locator('#daw-zoom-in').click();
    const followToggle = window.locator('#daw-follow-toggle');
    await expect(followToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(followToggle).toHaveAttribute('title', FOLLOW_FOLLOWING_TITLE);

    // Playback must be running before the tick in expectViewportPinnedWhilePaused: soundcheckStore
    // drops progress events unless `playing` is true. Play fires 'play' (a resume), so it happens
    // BEFORE the pausing gesture. start-playback is stubbed by the shared beforeEach.
    await window.locator('#daw-session-play').click();
    await expect(window.locator('#daw-session-stop')).toBeVisible();

    const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
    await window.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
    await window.mouse.wheel(SCROLL_DELTA_PX, 0);

    const shell = window.locator('.daw-shell');
    // Load-bearing: proves the wheel really reached onBoardWheel and moved the visible range,
    // so the pause below cannot be a coincidence of some other code path.
    await expect.poll(() => shell.evaluate((el) => getComputedStyle(el).getPropertyValue('--daw-scroll-x').trim())).not.toBe('0px');

    await expect(followToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(followToggle).toHaveAttribute('title', FOLLOW_PAUSED_TITLE);

    await expectViewportPinnedWhilePaused('manual scroll');

    await sendPlaybackEnded();
    await expect(window.locator('#daw-session-play')).toBeVisible();
  });

  test('follow-scroll pauses on a manual zoom wheel and leaves the viewport pinned (#1328)', async () => {
    // #1342 boots at the full range, so the range readout starts at the full session and no
    // Fit-click is needed before the zoom wheel narrows it.
    const followToggle = window.locator('#daw-follow-toggle');
    await expect(followToggle).toHaveAttribute('aria-pressed', 'true');

    const rangeReadout = window.locator('#daw-zoom-range');
    const rangeBefore = await rangeReadout.textContent();

    await window.locator('#daw-session-play').click();
    await expect(window.locator('#daw-session-stop')).toBeVisible();

    await window.locator('.daw-timeline').dispatchEvent('wheel', {
      deltaX: 0, deltaY: FOLLOW_ZOOM_WHEEL_DELTA_Y, ctrlKey: true, bubbles: true,
    });
    // Load-bearing: the readout changing proves the wheel landed as a ZOOM (the range narrowed
    // from the full session), not as a pan or a dropped event.
    await expect.poll(() => rangeReadout.textContent()).not.toBe(rangeBefore);

    await expect(followToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(followToggle).toHaveAttribute('title', FOLLOW_PAUSED_TITLE);

    await expectViewportPinnedWhilePaused('manual zoom');

    await sendPlaybackEnded();
    await expect(window.locator('#daw-session-play')).toBeVisible();
  });

  test('alignment holds immediately after follow-scroll resumes on a panned viewport (#1328)', async () => {
    // No playback here: assertFiveSurfacesAlignAt10s() holds a ruler scrub, and a running
    // transport's rAF repaint would overwrite its playhead preview — the same hazard the shared
    // beforeEach already documents when it calls stopCaptureIfRunning before loading the session.
    // #1342 boots at the full range, so zoom-in alone narrows it (no Fit-click first).
    await window.locator('#daw-zoom-in').click();
    await expect(window.locator('#daw-zoom-out')).toBeEnabled();

    const rulerBox = (await window.locator('.daw-ruler').boundingBox())!;
    await window.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
    await window.mouse.wheel(SCROLL_DELTA_PX, 0);

    const followToggle = window.locator('#daw-follow-toggle');
    await expect(followToggle).toHaveAttribute('aria-pressed', 'false');

    // The resume under test. Follow has no viewport to move yet (#1283, see the helper's note),
    // so the pan stays put across the resume — which is exactly why the invariant is measurable
    // here at a non-zero offset instead of collapsing back to the default scale.
    await followToggle.click();
    await expect(followToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(followToggle).toHaveAttribute('title', FOLLOW_FOLLOWING_TITLE);

    // Ruler tick, lane gridline, take-clip (waveform) right edge, scrub target and both playhead
    // segments, all at t=10s, immediately after the resume. The non-zero offset is load-bearing:
    // without it this would silently degrade into the default-scale case.
    const offset = await assertFiveSurfacesAlignAt10s();
    expect(offset).toBeGreaterThan(0);
  });

  test('loop brace edges align with the ruler and lane gridline (#1329)', async () => {
    const present = await enableLoopBraceIfPresent();
    test.skip(!present, 'loop brace is not present in this build (#1313/#1314) - pending');

    const brace = window.locator('.daw-loop-brace');
    await expect(brace).toBeVisible();
    const braceBox = (await brace.boundingBox())!;

    const startRef = await readRulerAndGridAt(LOOP_START_TICK_INDEX);
    const endRef = await readRulerAndGridAt(LOOP_END_TICK_INDEX);
    expectEdgeAligned('loop brace start edge', braceBox.x, startRef);
    expectEdgeAligned('loop brace end edge', braceBox.x + braceBox.width, endRef);

    // Ground the span in time, not just in ticks.
    const expectedWidth = (LOOP_DEFAULT_END_SECS - LOOP_DEFAULT_START_SECS) * endRef.pxPerSecond;
    expect(Math.abs(braceBox.width - expectedWidth)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);

    // Leave the board as the next beforeEach expects.
    await window.locator('#daw-session-loop').click();
  });

  test('time-selection edges align with the ruler and lane gridline (#1329)', async () => {
    const segments = window.locator('.daw-time-selection');
    test.skip(await segments.count() === 0, 'time-selection band is not present in this build (#1304) - pending');

    await dragRulerSelection(SELECTION_START_SECS, SELECTION_END_SECS);
    // Both segments boot with style="display:none", so visibility is the synchronisation
    // gate that proves renderTimeSelection has run.
    await expect(window.locator('.daw-time-selection-ruler')).toBeVisible();

    const startRef = await readRulerAndGridAt(SELECTION_START_TICK_INDEX);
    const endRef = await readRulerAndGridAt(SELECTION_END_TICK_INDEX);
    const expectedWidth = (SELECTION_END_SECS - SELECTION_START_SECS) * endRef.pxPerSecond;

    for (const { label, selector } of [
      { label: 'ruler', selector: '.daw-time-selection-ruler' },
      { label: 'lanes', selector: '.daw-time-selection-lanes' },
    ]) {
      const box = (await window.locator(selector).boundingBox())!;
      expectEdgeAligned(`${label} selection start`, box.x, startRef);
      expectEdgeAligned(`${label} selection end`, box.x + box.width, endRef);
      expect(Math.abs(box.width - expectedWidth)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
    }

    // Load-bearing negative assertion: the drag must NOT have committed a seek — proves the
    // gesture went down the drag route (canCommitSeek false once hasDragged()), not the
    // click/scrub route, i.e. the band under test was produced by a genuine drag.
    const seek = (await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__alignmentSeek,
    )) as { startOffsetSecs?: number } | null;
    expect(seek).toBeNull();
  });

});

// The frozen #1327 plan expected the record head's live-recording case to share this
// describe's beforeEach (a loaded take clip alongside a running recording). That does not
// hold in this checkout: LiveCapturePanel.tsx's session-load effect (~line 398) calls
// `runtime.setPlaybackPosition(lastElapsedTick)` whenever `soundcheck.manifest` is set —
// soundcheckStore.loadSession seeds `lastElapsedTick` to `{ elapsed: 0, duration: 0 }` (a
// truthy object) the moment a session loads, before playback ever starts, and there is no
// UI action that clears it afterwards (`daw-session-picker-select`'s empty option is a
// documented no-op in LiveCapturePanel.tsx's click handler). renderPlayhead()'s `elapsed`
// is `playbackPosition ? playbackPosition.elapsed * 1000 : wall clock` — so once a session
// is loaded the arrangement's single playhead is pinned to the loaded take's (frozen)
// position for the rest of the test, and a live recording's wall clock can never reach the
// screen, regardless of live-event ticks. tests/e2e/daw-shell.spec.ts's "starting a capture
// advances the transport time and moves the playhead" proves the wall-clock path only with
// no session loaded, confirming this is a real precondition of the checkout, not a flake.
// This describe therefore mirrors the shared beforeEach's device/lane setup WITHOUT the
// session-load step, so the record head's own case is exercised the same way #1327's design
// intended (clipZeroX legitimately NaN throughout, exactly as the frozen plan's grounding
// notes anticipated) instead of silently degrading into a no-op re-assertion of the
// playback path. No production code changes — this is a test-file-only divergence.
test.describe('Timeline alignment invariant during live recording (#1327)', () => {
  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test.beforeEach(async () => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('list-output-devices');
      ipcMain.handle('list-output-devices', () => ({ devices: [{ index: 1, name: 'MOTU 8ch', channels: 8 }] }));
    });
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await stopCaptureIfRunning(window);
    await window.locator('.mode-tab[data-mode="live"]').click();
    // Seed channelConfig so lanes (and their gridlines) exist — same dance the sibling
    // describe's beforeEach performs, minus the session-load step (see the comment above).
    await window.locator('#settings-btn').click();
    await window.locator('#settings-tab-btn-audio').click();
    await window.locator('#device-refresh-btn').click();
    await window.locator('#settings-dialog-done').click();
    await expect(window.locator('.daw-channel-lane')).toHaveCount(2);
    await stopCaptureIfRunning(window);
  });

  test('ruler tick, lane gridline and the record head share one x at multiple points during live recording (#1327)', async () => {
    // One click promotes idle -> monitoring -> recording (capture-lifecycle.ts's
    // startPlayhead(Date.now())); start-live/stop-live are stubbed by launchApp(), so no real
    // capture runs. The shared beforeEach leaves both strips armed, so #arm-hint cannot block.
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('REC');
    await expect(window.locator('.daw-playhead-lanes')).toBeVisible();

    const headLeft = () => window.locator('.daw-playhead-lanes').evaluate((el) => (el as HTMLElement).style.left);

    const samples: TimelineGeometrySample[] = [];
    for (let i = 0; i < RECORD_SAMPLE_COUNT; i++) {
      const before = await headLeft();
      await window.waitForTimeout(RECORD_SAMPLE_INTERVAL_MS);
      await sendLiveMeterTick();
      // Load-bearing: proves the PRODUCTION per-frame path (live tick -> rAF meter
      // controller -> renderPlayhead) is what advances the record head, so the sampler's own
      // repaint below is only a measurement instrument, not the behaviour under test.
      await expect.poll(headLeft).not.toBe(before);

      const sample = await sampleTimelineGeometry(true);
      expect(sample.laneHeadAdvancing).toBe(true);
      expect(sample.playheadElapsedSecs).toBeGreaterThan(0);
      expectHeadTracksTimelineAt(sample, sample.playheadElapsedSecs, `recording sample ${i}`);
      samples.push(sample);
    }

    // Real motion between consecutive samples — without this the test would still pass
    // against a frozen head that happens to sit at x=origin.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].playheadElapsedSecs).toBeGreaterThan(samples[i - 1].playheadElapsedSecs);
      expect(samples[i].laneHeadX - samples[i - 1].laneHeadX).toBeGreaterThanOrEqual(RECORD_HEAD_MIN_ADVANCE_PX);
    }

    // Leave the next beforeEach a known board (#776: stop -> monitoring resumes).
    await window.locator('#daw-session-record').click();
    await expect(window.locator('#live-indicator .live-txt')).toHaveText('LIVE');
    await stopCaptureIfRunning(window);
  });
});
