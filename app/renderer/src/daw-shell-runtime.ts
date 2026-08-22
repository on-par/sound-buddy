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

/** Ruler ticks at every DAW_RULER_TICK_INTERVAL_SECS from t=0 through
 *  spanSecs inclusive. Pure: each xPx is dawTimelineX(timeSecs), so a tick can
 *  never disagree with a lane gridline or the playhead about where a time sits.
 *  Counting in whole intervals (never accumulating a float) keeps the times
 *  exact — no epsilon comparison needed. A negative or non-finite span yields
 *  no ticks. */
export function dawRulerTicks(spanSecs: number): DawRulerTick[] {
  if (!Number.isFinite(spanSecs) || spanSecs < 0) return [];
  const count = Math.floor(spanSecs / DAW_RULER_TICK_INTERVAL_SECS) + 1;
  const ticks: DawRulerTick[] = [];
  for (let i = 0; i < count; i++) {
    const timeSecs = i * DAW_RULER_TICK_INTERVAL_SECS;
    ticks.push({ timeSecs, xPx: dawTimelineX(timeSecs) });
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
 *  inclusive. Pure: each xPx is dawTimelineX(timeSecs), so a gridline can never
 *  disagree with a ruler tick or the playhead about where a time sits (ADR-0086).
 *  Counting in whole intervals means every timeSecs is an exact integer, so the
 *  major test is exact modulo arithmetic — no epsilon needed. A negative or
 *  non-finite span yields no gridlines. */
export function dawLaneGridlines(spanSecs: number): DawLaneGridline[] {
  if (!Number.isFinite(spanSecs) || spanSecs < 0) return [];
  const count = Math.floor(spanSecs / DAW_LANE_GRID_MINOR_SECS) + 1;
  const lines: DawLaneGridline[] = [];
  for (let i = 0; i < count; i++) {
    const timeSecs = i * DAW_LANE_GRID_MINOR_SECS;
    lines.push({
      timeSecs,
      xPx: dawTimelineX(timeSecs),
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
}

export interface DawShellRuntime {
  startPlayhead(nowMs: number): void;
  stopPlayhead(): void;
  setPlaybackPosition(position: { elapsed: number; duration: number } | null): void;
  resetWaveform(intervalSecs: number): void;
  renderPlayhead(): void;
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
    const advancing = playbackPosition !== null || deps.dawPlayheadState.isAdvancing(playheadState);
    const segments = shell.querySelectorAll('.daw-playhead');
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as HTMLElement;
      segment.style.left = `${x}px`;
      segment.classList.toggle('advancing', advancing);
    }
  }

  // Sizes the canvas to its own `.daw-lane-body` parent (only when changed),
  // computes the pixel columns at the shared DAW_TIMELINE_PX_PER_SECOND scale
  // budgeted to the canvas's own drawable width (never the wider shell
  // width — avoids off-canvas clipping, #520), and draws via the pure export.
  function paintLane(canvas: DawCanvasElementLike, pairs: WaveformColumn[], strokeStyle: string): void {
    const laneBody = canvas.parentElement;
    const width = laneBody ? laneBody.clientWidth : 0;
    const height = laneBody ? laneBody.clientHeight : 0;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const columns = deps.dawWaveformState.columnPeaks(pairs, waveformBucketsPerSec, DAW_TIMELINE_PX_PER_SECOND, canvas.width);
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
    resetWaveform,
    renderPlayhead,
    renderWaveform,
    playheadElapsedMs,
    ingestPeaks,
    bindLiveEvents,
  };
}
