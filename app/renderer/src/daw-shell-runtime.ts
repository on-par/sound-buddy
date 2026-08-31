// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The DAW-style Live workspace shell's animation-rate rendering (TD-001
// slice 6j, #713): the playhead painter, the waveform-lane canvas painters,
// waveform render scheduling, and the 'peaks' live-event ingest — ported off
// inline-app.js as a DI factory, following ADR-0005 and the
// createSpectrumTransport/createLiveMeterController/createCaptureLifecycle
// pattern (every side effect injected, unit-tested with no DOM). The
// animation-rate state (playhead state, waveform state, per-input waveform
// lane states, the waveform bucket rate) lives in this factory's closure —
// never in liveCaptureStore, never in React state (ADR-0005: the playhead
// ticks every frame and peaks frames arrive up to several per second, so
// routing either through the store/React would re-render the board at the
// tick rate, #720's flicker defect). startPlayhead/stopPlayhead/resetWaveform
// are state-only transitions read by the capture lifecycle's DawShellSeam
// (capture-lifecycle.ts); the playhead ticker itself is a
// requestAnimationFrame-driven hook in LiveCapturePanel.tsx. 'peaks' frames
// are ingested by this module's own sb.onLiveEvent listener (bindLiveEvents),
// registered by App.tsx — inline-app.js's onLiveEvent no longer owns that
// branch.

// The shared arrangement scale (#1263, epic #1254). Imported TYPE-ONLY on
// purpose: timeline-scale.ts imports DAW_TIMELINE_ORIGIN_PX and
// DAW_TIMELINE_PX_PER_SECOND from this module, so a runtime import back would
// close an ESM cycle. Callers construct the scale (createTimelineScale) and
// inject it; this module only ever reads its timeToX.
import type { TimelineScale } from './timeline-scale';
// The arrangement's shared playhead/insert-marker model (#1301). Imported
// type-only for the same reason as TimelineScale above; TIMELINE_INSERT_MARKER_DEFAULT_SECS
// is imported separately as a value below (a plain constant, not a type — it
// creates no cycle).
import type { TimelineMarksModel } from './timeline-state';
import { TIMELINE_INSERT_MARKER_DEFAULT_SECS } from './timeline-state';
// The arrangement's clip selection (#1303). clip-selection.ts is a leaf module
// (imports nothing), so a value import here creates no ESM cycle.
import { CLIP_SELECTED_LANE_CLASS, type ClipSelectionModel } from './clip-selection';
// The arrangement's time-range selection (#1304). time-selection.ts is a leaf
// module (imports nothing), so a value import here creates no ESM cycle.
import { TIME_SELECTION_CLASS, type TimeSelectionModel } from './time-selection';
// The arrangement's loop region (#1313). loopBrace.render.ts is a leaf module
// (imports nothing), so a value import here creates no ESM cycle.
import { LOOP_BRACE_CLASS, type LoopRegion, type LoopRegionModel } from './loopBrace.render';
// The arrangement's accessible state labels (#1306). Leaf module (imports nothing), so a
// value import here creates no ESM cycle — same rationale as clip-selection.ts.
import {
  timelineAccessibilityLabels,
  TIMELINE_A11Y_REGION_CLASS,
  TIMELINE_A11Y_INSERT_MARKER_CLASS,
  TIMELINE_A11Y_PLAYHEAD_CLASS,
  TIMELINE_A11Y_CLIP_SELECTION_CLASS,
  TIMELINE_A11Y_TIME_SELECTION_CLASS,
} from './timeline-accessibility-labels';

export const DAW_TIMELINE_PX_PER_SECOND = 8; // one 40px ruler division = 5s
export const DAW_TIMELINE_INSET_PX = 4; // The playhead's right-edge inset — the arrangement's right margin, the x the playhead parks at instead of walking off the timeline column (kept, not retired: the timeline column's right edge is the shell's right edge)
// The shared t=0 edge for the arrangement view's ruler ticks, lane
// gridlines and playhead (#1026/#1031) — the track-head column's right
// edge in shell-local pixels (docs/design/session-tab.md's 208px column).
export const DAW_TIMELINE_ORIGIN_PX = 208;

/** Converts a timeline position in seconds to a shell-local x coordinate in
 *  pixels. Pure and unclamped — negative seconds return coordinates left of
 *  the origin; clamping to the visible lane width is the caller's job
 *  (dawPlayheadX does that for the playhead). */
export function dawTimelineX(timeSecs: number): number {
  return DAW_TIMELINE_ORIGIN_PX + timeSecs * DAW_TIMELINE_PX_PER_SECOND;
}

// Milliseconds per second — the playhead's state clock is in ms, the shared
// timeline geometry is in seconds.
const MS_PER_SECOND = 1000;

/** The playhead's shell-local x for an elapsed capture time in ms — the same
 *  coordinate a ruler tick or lane gridline gets for that instant, because it
 *  is the same dawTimelineX call (ADR-0086). Clamped to the visible shell: it
 *  never sits left of the shared t=0 origin and parks at the right inset
 *  instead of walking off-screen. Non-finite inputs resolve to the origin
 *  rather than writing NaN into a transform. */
export function dawPlayheadX(elapsedMs: number, shellWidthPx: number): number {
  const secs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) / MS_PER_SECOND : 0;
  const maxX = Number.isFinite(shellWidthPx)
    ? Math.max(DAW_TIMELINE_ORIGIN_PX, shellWidthPx - DAW_TIMELINE_INSET_PX)
    : DAW_TIMELINE_ORIGIN_PX;
  return Math.min(maxX, Math.max(DAW_TIMELINE_ORIGIN_PX, dawTimelineX(secs)));
}

// The ruler's tick division, in seconds. 5s at DAW_TIMELINE_PX_PER_SECOND is
// exactly the 40px division the ruler painted as a CSS gradient before #1032 —
// the interval itself is unchanged by this story (docs/design/session-tab.md's
// 10s labelled ticks are #1028's concern).
export const DAW_RULER_TICK_INTERVAL_SECS = 5;
// How much arrangement time the ruler ticks and lane gridlines lay out over.
// The ruler row and lanes clip their own overflow, so this is a fixed strip
// rather than a viewport-aware count — a width-aware (and zoomable) tick
// range lands with the arrangement layout (#1028). 300s covers the widest
// lane column at the current scale.
export const DAW_TIMELINE_SPAN_SECS = 300;

/** One ruler tick: the arrangement time it marks and the shell-local x
 *  coordinate for that time, straight from the shared geometry. */
export interface DawRulerTick {
  timeSecs: number;
  xPx: number;
}

/** Resolves the time-to-x conversion a tick/gridline builder should use: the
 *  injected shared scale's when one is supplied, the fixed default geometry
 *  (dawTimelineX) otherwise. The no-scale branch is exactly the pre-#1263
 *  behavior, which is why an un-injected caller renders identical pixels. */
function timelineTimeToX(scale: TimelineScale | undefined): (timeSecs: number) => number {
  return scale ? (timeSecs: number) => scale.timeToX(timeSecs) : dawTimelineX;
}

/** Resolves the pixels-per-second a waveform downsampler should bucket at: the
 *  injected shared scale's when one is supplied, the fixed default geometry
 *  otherwise. The no-scale branch is exactly the pre-#1265 constant, which is
 *  why an un-injected runtime paints identical columns. */
function timelineScalePxPerSecond(scale: TimelineScale | undefined): number {
  return scale ? scale.pxPerSecond : DAW_TIMELINE_PX_PER_SECOND;
}

/** Ruler ticks at every DAW_RULER_TICK_INTERVAL_SECS from t=0 through
 *  spanSecs inclusive. Pure: each xPx comes from the injected TimelineScale's
 *  timeToX, or from dawTimelineX when no scale is injected — so a tick can
 *  never disagree with a lane gridline or the playhead about where a time
 *  sits. Counting in whole intervals (never accumulating a float) keeps the
 *  times exact — no epsilon comparison needed. A negative or non-finite span
 *  yields no ticks. */
export function dawRulerTicks(spanSecs: number, scale?: TimelineScale): DawRulerTick[] {
  if (!Number.isFinite(spanSecs) || spanSecs < 0) return [];
  const timeToX = timelineTimeToX(scale);
  const count = Math.floor(spanSecs / DAW_RULER_TICK_INTERVAL_SECS) + 1;
  const ticks: DawRulerTick[] = [];
  for (let i = 0; i < count; i++) {
    const timeSecs = i * DAW_RULER_TICK_INTERVAL_SECS;
    ticks.push({ timeSecs, xPx: timeToX(timeSecs) });
  }
  return ticks;
}

// Lane gridline divisions, in seconds (docs/design/session-tab.md, "Lane
// anatomy"): a minor line every 5s, promoted to a major line every 10s. These
// are time divisions, never pixel spacings — the pixels come from
// dawTimelineX alone.
export const DAW_LANE_GRID_MINOR_SECS = 5;
export const DAW_LANE_GRID_MAJOR_SECS = 10;

/** One lane gridline: the arrangement time it marks, the shell-local x
 *  coordinate for that time straight from the shared geometry, and whether it
 *  is a major (10s) rather than minor (5s) division. */
export interface DawLaneGridline {
  timeSecs: number;
  xPx: number;
  isMajor: boolean;
}

/** Lane gridlines at every DAW_LANE_GRID_MINOR_SECS from t=0 through spanSecs
 *  inclusive. Pure: each xPx comes from the injected TimelineScale's timeToX,
 *  or from dawTimelineX when no scale is injected — so a gridline can never
 *  disagree with a ruler tick or the playhead about where a time sits
 *  (ADR-0086). Counting in whole intervals means every timeSecs is an exact
 *  integer, so the major test is exact modulo arithmetic — no epsilon needed.
 *  A negative or non-finite span yields no gridlines. */
export function dawLaneGridlines(spanSecs: number, scale?: TimelineScale): DawLaneGridline[] {
  if (!Number.isFinite(spanSecs) || spanSecs < 0) return [];
  const timeToX = timelineTimeToX(scale);
  const count = Math.floor(spanSecs / DAW_LANE_GRID_MINOR_SECS) + 1;
  const lines: DawLaneGridline[] = [];
  for (let i = 0; i < count; i++) {
    const timeSecs = i * DAW_LANE_GRID_MINOR_SECS;
    lines.push({
      timeSecs,
      xPx: timeToX(timeSecs),
      isMajor: timeSecs % DAW_LANE_GRID_MAJOR_SECS === 0,
    });
  }
  return lines;
}

// Recording-vs-monitoring waveform stroke, matching the transport-chip colors
// (--issue-text/--gold-text/--text-muted in app.css) — canvas drawing can't
// read CSS custom properties, so these are named constants (ported verbatim
// from inline-app.js's WAVEFORM_COLORS, #520).
export const WAVEFORM_COLORS = {
  recording: '#F26D71',
  monitoring: '#F3CA5E',
  stopped: '#565D6B',
} as const;

/** One decoded min/max waveform peak bucket, both values in [-1, 1]. */
export interface WaveformColumn {
  min: number;
  max: number;
}

/** The subset of CanvasRenderingContext2D the pure draw uses — a local
 *  structural type (soundcheck-waveform.ts's WaveformCanvasLike precedent)
 *  so a recording fake satisfies it in tests without `any` and without a DOM
 *  canvas. */
export interface DawWaveformCanvasLike {
  strokeStyle: string;
  lineWidth: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/** Draws one waveform lane: one 1px vertical stroke per column. clearRect
 *  first, then return early for a zero-size canvas or no columns. Silence
 *  still draws a min-1px-tall hairline (yBottom = max(yTop + 1, …)) —
 *  verbatim port of inline-app.js's drawWaveformLane draw body. */
export function drawDawWaveformLane(
  ctx: DawWaveformCanvasLike,
  columns: WaveformColumn[],
  width: number,
  height: number,
  strokeStyle: string,
): void {
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0 || columns.length === 0) return;

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;

  const midY = height / 2;
  for (let x = 0; x < columns.length; x++) {
    const col = columns[x];
    const yTop = midY - col.max * midY;
    const yBottom = Math.max(yTop + 1, midY - col.min * midY); // min 1px tall — silence draws a hairline
    ctx.beginPath();
    ctx.moveTo(x + 0.5, yTop);
    ctx.lineTo(x + 0.5, yBottom);
    ctx.stroke();
  }
}

/** A waveform column is exactly one device pixel wide at EVERY zoom state
 *  (ADR: live lane waveform columns are one pixel wide at every zoom).
 *  drawDawWaveformLane strokes one 1px line per column, so the scale changes how
 *  much TIME a column covers — never its width. */
export const DAW_WAVEFORM_COLUMN_WIDTH_PX = 1;

/** The arrangement time, in seconds, at the left edge of waveform column
 *  `columnIndex` when the lane is downsampled at `scale` — the inverse of the
 *  column budget columnPeaks buckets with. With no scale it is the fixed
 *  default geometry, i.e. the pre-#1265 behavior. */
export function dawWaveformColumnTimeSecs(columnIndex: number, scale?: TimelineScale): number {
  return (columnIndex * DAW_WAVEFORM_COLUMN_WIDTH_PX) / timelineScalePxPerSecond(scale);
}

/** The x offset, in pixels, of waveform column `columnIndex` from its lane's own
 *  t=0 edge — the coordinate drawDawWaveformLane strokes at. It carries no scale
 *  argument on purpose: columns are pixels, so this must equal the shared scale's
 *  own time-to-x offset for dawWaveformColumnTimeSecs(columnIndex, scale) at every
 *  zoom state, and daw-shell-runtime.test.ts asserts exactly that. Note the lane
 *  canvas's left edge is NOT DAW_TIMELINE_ORIGIN_PX — a live lane body sits inside
 *  the lane row's padding and name cell — so this is a lane-local offset, never a
 *  shell-local x. */
export function dawWaveformColumnX(columnIndex: number): number {
  return columnIndex * DAW_WAVEFORM_COLUMN_WIDTH_PX;
}

/* ── Deps + seam interfaces (the daw-playhead-state.js/daw-waveform-state.js
   classic scripts, structurally typed, mirroring live-workspace-view.ts's
   DawPlayheadStateApi/DawWaveformStateApi accessors) ── */

// daw-playhead-state.js owns wall-clock playhead time only — no pixels.
// Shell-local geometry (dawTimelineX/dawPlayheadX) lives entirely in this module.
export interface DawPlayheadStateApi {
  start(nowMs: number): unknown;
  stop(state: unknown, nowMs: number): unknown;
  isAdvancing(state: unknown): boolean;
  elapsedMs(state: unknown, nowMs: number): number;
  formatElapsed(ms: number): string;
}

export interface DawWaveformStateShape {
  pairs: WaveformColumn[];
}

export interface DawWaveformStateApi {
  create(): DawWaveformStateShape;
  append(state: DawWaveformStateShape, pairs: WaveformColumn[]): DawWaveformStateShape;
  bucketsPerSecond(intervalSecs: number): number;
  decodeLanes(frame: unknown): Record<string, WaveformColumn[]> | null;
  columnPeaks(pairs: WaveformColumn[], bucketsPerSec: number, pxPerSecond: number, maxPx: number): WaveformColumn[];
  captureModeToken(liveRunning: boolean, liveMode: string): string;
}

export interface DawShellRuntimeDeps {
  doc: Pick<Document, 'querySelector'>;
  now(): number;
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  subscribeLiveEvent(cb: (data: unknown) => void): void;
  getCaptureState(): { isCapturing: boolean; liveMode: 'monitor' | 'record' };
  dawPlayheadState: DawPlayheadStateApi;
  dawWaveformState: DawWaveformStateApi;
  /** The arrangement's current horizontal scale (#1265, epic #1254), read once per
   *  lane paint so a future zoom state reaches the painter with no signature change.
   *  Optional: an un-injected runtime falls back to the fixed default geometry. */
  getTimelineScale?(): TimelineScale;
  /** The arrangement's shared playhead/insert-marker positions (#1301). Optional: an
   *  un-injected runtime paints the marker at the default position and writes nowhere,
   *  which is exactly the pre-#1301 behaviour. */
  timelineMarks?: TimelineMarksModel;
  /** The arrangement's clip selection (#1303). Optional: an un-injected runtime paints
   *  nothing selected, exactly the pre-#1303 behaviour. */
  clipSelection?: ClipSelectionModel;
  /** The arrangement's time selection (#1304). Optional: an un-injected runtime paints
   *  no band, exactly the pre-#1304 behaviour. */
  timeSelection?: TimeSelectionModel;
  /** The arrangement's loop region (#1313). Optional: an un-injected runtime paints no
   *  brace, exactly the pre-#1313 behaviour. */
  loopRegion?: LoopRegionModel;
}

export interface DawShellRuntime {
  startPlayhead(nowMs: number): void;
  stopPlayhead(): void;
  setPlaybackPosition(position: { elapsed: number; duration: number } | null): void;
  setPlaybackActive(active: boolean): void;
  resetWaveform(intervalSecs: number): void;
  renderPlayhead(): void;
  renderInsertMarker(): void;
  renderClipSelection(): void;
  renderTimeSelection(): void;
  renderLoopBrace(): void;
  previewLoopBrace(region: LoopRegion): void;
  renderAccessibilityLabels(): void;
  renderWaveform(): void;
  playheadElapsedMs(): number;
  ingestPeaks(data: unknown): void;
  bindLiveEvents(): void;
}

// The canvas-element shape paintLane needs — a local structural type (like
// DawWaveformCanvasLike) so a fake `.daw-mix-waveform`/`.daw-channel-waveform`
// satisfies it in tests without a real HTMLCanvasElement.
interface DawCanvasElementLike {
  parentElement: { clientWidth: number; clientHeight: number } | null;
  width: number;
  height: number;
  getContext(kind: '2d'): DawWaveformCanvasLike | null;
}

export function createDawShellRuntime(deps: DawShellRuntimeDeps): DawShellRuntime {
  let playheadState: unknown = null;
  let playbackPosition: { elapsed: number; duration: number } | null = null;
  let playbackActive = false;
  let waveformState: DawWaveformStateShape = deps.dawWaveformState.create();
  // The default bucket rate before any capture has reported its own meter
  // interval via resetWaveform() — 0 is an invalid interval, so the injected
  // classic script's own guard resolves it to its documented default rate
  // (mirrors inline-app.js's window.dawWaveformState.WAVEFORM_BUCKETS_PER_SEC
  // seed without hardcoding that constant here).
  let waveformBucketsPerSec = deps.dawWaveformState.bucketsPerSecond(0);
  let waveformLaneStates: Record<string, DawWaveformStateShape> = {};
  let waveformRenderScheduled = false;
  let rafHandle: number | null = null;

  function startPlayhead(nowMs: number): void {
    playheadState = deps.dawPlayheadState.start(nowMs);
  }

  function stopPlayhead(): void {
    playheadState = deps.dawPlayheadState.stop(playheadState, deps.now());
    renderPlayhead(); // paint the frozen time
  }

  function setPlaybackPosition(position: { elapsed: number; duration: number } | null): void {
    playbackPosition = position;
  }

  function setPlaybackActive(active: boolean): void {
    playbackActive = active;
  }

  function resetWaveform(intervalSecs: number): void {
    // A stale scheduled repaint from the previous session would just repaint
    // the fresh (now-empty) state below — canceling it avoids one redundant
    // paint, not a correctness fix.
    if (rafHandle !== null) { deps.cancelRaf(rafHandle); rafHandle = null; }
    waveformRenderScheduled = false;
    waveformState = deps.dawWaveformState.create();
    waveformBucketsPerSec = deps.dawWaveformState.bucketsPerSecond(intervalSecs);
    waveformLaneStates = {};
  }

  function playheadElapsedMs(): number {
    return deps.dawPlayheadState.elapsedMs(playheadState, deps.now());
  }

  // Patches the DAW shell's transport time and playhead line in place — never
  // rebuilds DOM (#518).
  function renderPlayhead(): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return; // DAW toggle off or not on Live tab
    const elapsed = playbackPosition
      ? playbackPosition.elapsed * MS_PER_SECOND
      : deps.dawPlayheadState.elapsedMs(playheadState, deps.now());
    const timeEl = shell.querySelector('.daw-transport-time');
    const text = deps.dawPlayheadState.formatElapsed(elapsed);
    if (timeEl && timeEl.textContent !== text) timeEl.textContent = text;
    // One instant is one number: the x and the advancing flag are computed once
    // and written to EVERY .daw-playhead segment (ruler + lane column) in the same
    // pass, so the two regions are structurally incapable of disagreeing (#1049).
    // The x rides `left` — the same property a ruler tick or gridline carries —
    // because the transform slot belongs to the shared head-width re-base in
    // app.css (ADR-0090).
    const x = dawPlayheadX(elapsed, shell.clientWidth);
    const advancing = playbackPosition !== null
      ? playbackActive
      : deps.dawPlayheadState.isAdvancing(playheadState);
    const segments = shell.querySelectorAll('.daw-playhead');
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as HTMLElement;
      segment.style.left = `${x}px`;
      segment.classList.toggle('advancing', advancing);
    }
    // The playhead's single writer (#1301): this is the one place the arrangement resolves
    // "the instant being shown" — the playback tick when a session is playing, the wall
    // clock otherwise — so the shared value can never disagree with the painted pixels.
    deps.timelineMarks?.setPlayheadSecs(elapsed / MS_PER_SECOND);
    renderInsertMarker();
  }

  // The insert marker (#1301): where a play/edit action would start, painted from the same
  // shared geometry as the playhead so the two can never disagree about where a second
  // sits. Separate from renderPlayhead so it stays off the per-frame path in spirit (it
  // only moves on load or an explicit edit) and so renderPlayhead keeps its one-x guard.
  function renderInsertMarker(): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return;
    const secs = deps.timelineMarks?.getInsertMarkerSecs() ?? TIMELINE_INSERT_MARKER_DEFAULT_SECS;
    const markerX = dawPlayheadX(secs * MS_PER_SECOND, shell.clientWidth);
    const segments = shell.querySelectorAll('.daw-insert-marker');
    for (let i = 0; i < segments.length; i++) {
      (segments[i] as HTMLElement).style.left = `${markerX}px`;
    }
    renderAccessibilityLabels();
  }

  // The clip selection (#1303): toggles CLIP_SELECTED_LANE_CLASS on the lane whose
  // data-ch matches the selection. A press-time and post-rebuild painter, never a
  // per-frame one — like renderInsertMarker, it stays off the animation path.
  function renderClipSelection(): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return;
    const selected = deps.clipSelection?.getSelectedChannel() ?? null;
    const lanes = shell.querySelectorAll('.daw-channel-lane');
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i] as HTMLElement;
      lane.classList.toggle(
        CLIP_SELECTED_LANE_CLASS,
        selected !== null && lane.getAttribute('data-ch') === String(selected),
      );
    }
    renderAccessibilityLabels();
  }

  // The time selection band (#1304): painted through the SAME dawPlayheadX geometry as
  // the playhead and insert marker, so the band's edges can never disagree with where
  // the marker says a second sits. Off the per-frame path, like renderInsertMarker.
  function renderTimeSelection(): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return;
    const range = deps.timeSelection?.getSelection() ?? null;
    const segments = shell.querySelectorAll(`.${TIME_SELECTION_CLASS}`);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as HTMLElement;
      if (!range) { segment.style.display = 'none'; continue; }
      const leftX = dawPlayheadX(range.startSecs * MS_PER_SECOND, shell.clientWidth);
      const rightX = dawPlayheadX(range.endSecs * MS_PER_SECOND, shell.clientWidth);
      segment.style.display = '';
      segment.style.left = `${leftX}px`;
      segment.style.width = `${Math.max(0, rightX - leftX)}px`;
    }
    renderAccessibilityLabels();
  }

  // The loop brace (#1313): painted through the SAME dawPlayheadX geometry as the playhead,
  // insert marker and time-selection band, so the brace's edges can never disagree with where
  // the ruler says a second sits. The handles are CSS children of the brace, so they inherit
  // this geometry. Off the per-frame path, like renderInsertMarker — renderPlayhead must NOT
  // call it.
  function paintLoopBrace(region: LoopRegion | null): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return;
    const segments = shell.querySelectorAll(`.${LOOP_BRACE_CLASS}`);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as HTMLElement;
      if (!region) { segment.style.display = 'none'; continue; }
      const leftX = dawPlayheadX(region.startSecs * MS_PER_SECOND, shell.clientWidth);
      const rightX = dawPlayheadX(region.endSecs * MS_PER_SECOND, shell.clientWidth);
      segment.style.display = '';
      segment.style.left = `${leftX}px`;
      segment.style.width = `${Math.max(0, rightX - leftX)}px`;
    }
  }

  function renderLoopBrace(): void { paintLoopBrace(deps.loopRegion?.getRegion() ?? null); }

  // The in-flight brace during a body drag (#1315): painted through the SAME
  // paintLoopBrace as the committed range, so a previewed brace can never drift
  // from the ruler ticks. Writes nothing to the shared model — the drag commits
  // on release (this story's ADR).
  function previewLoopBrace(region: LoopRegion): void { paintLoopBrace(region); }

  // The arrangement's accessible state (#1306): the four hidden spans, patched from the
  // SAME shared models the pixels are painted from, so the announced state can never
  // disagree with the screen. Writes only on a real text change — renderPlayhead reaches
  // this every frame via renderInsertMarker, and the labels are second-granularity, so a
  // playing session performs at most one write per span per second. The region carries no
  // live-announcing role and must never gain one (this story's ADR).
  function patchAccessibilityLabel(region: Element, className: string, text: string): void {
    const el = region.querySelector(`.${className}`);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function renderAccessibilityLabels(): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return;
    const region = shell.querySelector(`.${TIMELINE_A11Y_REGION_CLASS}`);
    if (!region) return;
    const labels = timelineAccessibilityLabels({
      playheadSecs: deps.timelineMarks?.getPlayheadSecs() ?? 0,
      insertMarkerSecs: deps.timelineMarks?.getInsertMarkerSecs() ?? TIMELINE_INSERT_MARKER_DEFAULT_SECS,
      selectedClipChannel: deps.clipSelection?.getSelectedChannel() ?? null,
      timeSelection: deps.timeSelection?.getSelection() ?? null,
    });
    patchAccessibilityLabel(region, TIMELINE_A11Y_INSERT_MARKER_CLASS, labels.insertMarker);
    patchAccessibilityLabel(region, TIMELINE_A11Y_PLAYHEAD_CLASS, labels.playhead);
    patchAccessibilityLabel(region, TIMELINE_A11Y_CLIP_SELECTION_CLASS, labels.clipSelection);
    patchAccessibilityLabel(region, TIMELINE_A11Y_TIME_SELECTION_CLASS, labels.timeSelection);
  }

  // Sizes the canvas to its own `.daw-lane-body` parent (only when changed),
  // computes the pixel columns at the injected TimelineScale's pxPerSecond
  // (#1265; falls back to DAW_TIMELINE_PX_PER_SECOND when no scale is
  // injected) budgeted to the canvas's own drawable width (never the wider
  // shell width — avoids off-canvas clipping, #520), and draws via the pure
  // export.
  function paintLane(canvas: DawCanvasElementLike, pairs: WaveformColumn[], strokeStyle: string): void {
    const laneBody = canvas.parentElement;
    const width = laneBody ? laneBody.clientWidth : 0;
    const height = laneBody ? laneBody.clientHeight : 0;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pxPerSecond = timelineScalePxPerSecond(deps.getTimelineScale?.());
    const columns = deps.dawWaveformState.columnPeaks(pairs, waveformBucketsPerSec, pxPerSecond, canvas.width);
    drawDawWaveformLane(ctx, columns, canvas.width, canvas.height, strokeStyle);
  }

  // Patches the DAW shell's waveform canvases in place — never rebuilds DOM
  // (#520, #521): the mix lane plus one canvas per per-input channel lane.
  function renderWaveform(): void {
    const shell = deps.doc.querySelector('.daw-shell');
    if (!shell) return; // DAW toggle off or not on Live tab
    const canvas = shell.querySelector('.daw-mix-waveform') as unknown as DawCanvasElementLike | null;
    if (!canvas) return;

    const capture = deps.getCaptureState();
    const captureMode = deps.dawWaveformState.captureModeToken(capture.isCapturing, capture.liveMode);
    const strokeStyle = WAVEFORM_COLORS[captureMode as keyof typeof WAVEFORM_COLORS] || WAVEFORM_COLORS.stopped;

    paintLane(canvas, waveformState.pairs, strokeStyle);

    const lanes = shell.querySelectorAll('.daw-channel-lane');
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      const laneCanvas = lane.querySelector('.daw-channel-waveform') as unknown as DawCanvasElementLike | null;
      if (!laneCanvas) continue;
      const state = waveformLaneStates['strip' + lane.getAttribute('data-ch')];
      paintLane(laneCanvas, state ? state.pairs : [], strokeStyle);
    }
  }

  // Coalesces peaks-frame repaints to one per animation frame, mirroring
  // scheduleLiveMeters' rAF batching — peaks frames can arrive at the meter
  // cadence (up to several per second), and each repaint forces a layout read
  // (clientWidth/clientHeight), so batching avoids uncoalesced, redundant
  // paint work (#520).
  function scheduleWaveformRender(): void {
    if (waveformRenderScheduled) return;
    waveformRenderScheduled = true;
    rafHandle = deps.raf(() => {
      waveformRenderScheduled = false;
      rafHandle = null;
      renderWaveform();
    });
  }

  function ingestPeaks(data: unknown): void {
    const lanes = deps.dawWaveformState.decodeLanes(data);
    if (!lanes) return;
    if (lanes.mix) waveformState = deps.dawWaveformState.append(waveformState, lanes.mix);
    for (const id of Object.keys(lanes)) {
      if (id === 'mix') continue;
      waveformLaneStates[id] = deps.dawWaveformState.append(
        waveformLaneStates[id] || deps.dawWaveformState.create(), lanes[id]);
    }
    scheduleWaveformRender();
  }

  function bindLiveEvents(): void {
    deps.subscribeLiveEvent((data) => {
      if (!data || (data as { type?: string }).type !== 'peaks') return;
      ingestPeaks(data);
    });
  }

  return {
    startPlayhead,
    stopPlayhead,
    setPlaybackPosition,
    setPlaybackActive,
    resetWaveform,
    renderPlayhead,
    renderInsertMarker,
    renderClipSelection,
    renderTimeSelection,
    renderLoopBrace,
    previewLoopBrace,
    renderAccessibilityLabels,
    renderWaveform,
    playheadElapsedMs,
    ingestPeaks,
    bindLiveEvents,
  };
}
