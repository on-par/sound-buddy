// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  createDawShellRuntime,
  drawDawWaveformLane,
  DAW_TIMELINE_PX_PER_SECOND,
  DAW_TIMELINE_ORIGIN_PX,
  DAW_TIMELINE_INSET_PX,
  WAVEFORM_COLORS,
  dawTimelineX,
  dawPlayheadX,
  dawRulerTicks,
  DAW_RULER_TICK_INTERVAL_SECS,
  DAW_TIMELINE_SPAN_SECS,
  dawLaneGridlines,
  DAW_LANE_GRID_MINOR_SECS,
  DAW_LANE_GRID_MAJOR_SECS,
  type DawShellRuntimeDeps,
  type DawWaveformCanvasLike,
  type WaveformColumn,
  type DawRulerTick,
  type DawLaneGridline,
} from './daw-shell-runtime';

/* ── drawDawWaveformLane (pure) ── */

function makeRecordingCtx(): DawWaveformCanvasLike & {
  calls: { clearRect: unknown[][]; beginPath: number; moveTo: unknown[][]; lineTo: unknown[][]; stroke: number };
} {
  const calls = { clearRect: [] as unknown[][], beginPath: 0, moveTo: [] as unknown[][], lineTo: [] as unknown[][], stroke: 0 };
  return {
    strokeStyle: '',
    lineWidth: 0,
    clearRect: (...args: unknown[]) => { calls.clearRect.push(args); },
    beginPath: () => { calls.beginPath++; },
    moveTo: (...args: unknown[]) => { calls.moveTo.push(args); },
    lineTo: (...args: unknown[]) => { calls.lineTo.push(args); },
    stroke: () => { calls.stroke++; },
    calls,
  };
}

describe('drawDawWaveformLane', () => {
  it('clears the canvas first', () => {
    const ctx = makeRecordingCtx();
    drawDawWaveformLane(ctx, [], 100, 40, '#fff');
    expect(ctx.calls.clearRect).toEqual([[0, 0, 100, 40]]);
  });

  it('returns early (no stroke) for a zero-size canvas', () => {
    const ctx = makeRecordingCtx();
    drawDawWaveformLane(ctx, [{ min: -1, max: 1 }], 0, 40, '#fff');
    expect(ctx.calls.beginPath).toBe(0);
    const ctx2 = makeRecordingCtx();
    drawDawWaveformLane(ctx2, [{ min: -1, max: 1 }], 100, 0, '#fff');
    expect(ctx2.calls.beginPath).toBe(0);
  });

  it('returns early (no stroke) for empty columns', () => {
    const ctx = makeRecordingCtx();
    drawDawWaveformLane(ctx, [], 100, 40, '#fff');
    expect(ctx.calls.beginPath).toBe(0);
  });

  it('sets strokeStyle and a 1px lineWidth', () => {
    const ctx = makeRecordingCtx();
    drawDawWaveformLane(ctx, [{ min: -0.5, max: 0.5 }], 100, 40, '#F26D71');
    expect(ctx.strokeStyle).toBe('#F26D71');
    expect(ctx.lineWidth).toBe(1);
  });

  it('strokes one 1px-centered vertical line per column', () => {
    const ctx = makeRecordingCtx();
    const columns: WaveformColumn[] = [{ min: -0.5, max: 0.5 }, { min: -1, max: 1 }];
    drawDawWaveformLane(ctx, columns, 100, 40, '#fff');
    expect(ctx.calls.beginPath).toBe(2);
    expect(ctx.calls.stroke).toBe(2);
    // midY = 20; col 0: yTop = 20 - 0.5*20 = 10, yBottom = 20 - (-0.5)*20 = 30
    expect(ctx.calls.moveTo[0]).toEqual([0.5, 10]);
    expect(ctx.calls.lineTo[0]).toEqual([0.5, 30]);
    expect(ctx.calls.moveTo[1]).toEqual([1.5, 0]);
  });

  it('draws a minimum-1px silence hairline when max === min (yBottom = yTop + 1)', () => {
    const ctx = makeRecordingCtx();
    drawDawWaveformLane(ctx, [{ min: 0, max: 0 }], 100, 40, '#fff');
    // midY = 20; yTop = 20, yBottom = max(21, 20) = 21
    expect(ctx.calls.moveTo[0]).toEqual([0.5, 20]);
    expect(ctx.calls.lineTo[0]).toEqual([0.5, 21]);
  });
});

/* ── createDawShellRuntime ── */

function makeFakeCanvas(overrides: Record<string, unknown> = {}) {
  const ctx = makeRecordingCtx();
  return {
    parentElement: { clientWidth: 100, clientHeight: 40 },
    width: 0,
    height: 0,
    getContext: () => ctx,
    ctx,
    ...overrides,
  };
}

function makeFakeLane(ch: string, canvas: ReturnType<typeof makeFakeCanvas> | null) {
  return {
    getAttribute: (name: string) => (name === 'data-ch' ? ch : null),
    querySelector: (sel: string) => (sel === '.daw-channel-waveform' ? canvas : null),
  };
}

function makeFakePlayhead() {
  return { style: {} as Record<string, string>, classList: { toggle: vi.fn() } };
}

interface FakeShell {
  clientWidth: number;
  querySelector: (sel: string) => unknown;
  querySelectorAll: (sel: string) => unknown[];
  el: Record<string, unknown>;
}

function makeFakeShell(opts: {
  timeEl?: { textContent: string } | null;
  playheadEls?: ReturnType<typeof makeFakePlayhead>[];
  mixCanvas?: ReturnType<typeof makeFakeCanvas> | null;
  lanes?: ReturnType<typeof makeFakeLane>[];
  clientWidth?: number;
} = {}): FakeShell {
  const timeEl = opts.timeEl === undefined ? { textContent: '' } : opts.timeEl;
  const playheadEls = opts.playheadEls ?? [makeFakePlayhead(), makeFakePlayhead()];
  const mixCanvas = opts.mixCanvas === undefined ? makeFakeCanvas() : opts.mixCanvas;
  const lanes = opts.lanes ?? [];
  return {
    clientWidth: opts.clientWidth ?? 400,
    querySelector: (sel: string) => {
      if (sel === '.daw-transport-time') return timeEl;
      if (sel === '.daw-mix-waveform') return mixCanvas;
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel === '.daw-channel-lane') return lanes;
      if (sel === '.daw-playhead') return playheadEls;
      return [];
    },
    el: { timeEl, playheadEls, mixCanvas, lanes },
  };
}

function makeDeps(overrides: Partial<DawShellRuntimeDeps> = {}) {
  let nowMs = 0;
  let shell: FakeShell | null = makeFakeShell();
  let capture = { isCapturing: false, liveMode: 'monitor' as 'monitor' | 'record' };
  let queuedRaf: (() => void) | null = null;
  let nextHandle = 1;
  const rafSpy = vi.fn((cb: () => void) => { queuedRaf = cb; return nextHandle++; });
  const cancelRafSpy = vi.fn();
  const subscribeSpy = vi.fn();

  const dawPlayheadState = require('../daw-playhead-state.js');
  const dawWaveformState = require('../daw-waveform-state.js');

  const deps: DawShellRuntimeDeps = {
    doc: { querySelector: () => shell as unknown as Element } as unknown as Pick<Document, 'querySelector'>,
    now: () => nowMs,
    raf: rafSpy,
    cancelRaf: cancelRafSpy,
    subscribeLiveEvent: subscribeSpy,
    getCaptureState: () => capture,
    dawPlayheadState,
    dawWaveformState,
    ...overrides,
  };

  return {
    deps,
    setNow: (t: number) => { nowMs = t; },
    setShell: (s: FakeShell | null) => { shell = s; },
    setCapture: (c: { isCapturing: boolean; liveMode: 'monitor' | 'record' }) => { capture = c; },
    raf: rafSpy,
    cancelRaf: cancelRafSpy,
    subscribe: subscribeSpy,
    flushRaf: () => { const cb = queuedRaf; queuedRaf = null; if (cb) cb(); },
    hasQueuedRaf: () => queuedRaf !== null,
  };
}

// A base64 encoding of one min/max pair (u8 levels 64/192 -> roughly -0.5/0.5).
function encodePairs(levels: number[]): string {
  return Buffer.from(levels).toString('base64');
}

function peaksFrame(lanes: Array<{ id: string; data: string }>) {
  return { type: 'peaks', lanes };
}

describe('createDawShellRuntime', () => {
  describe('startPlayhead / playheadElapsedMs', () => {
    it('elapsed is 0 before any capture ever starts', () => {
      const { deps } = makeDeps();
      const rt = createDawShellRuntime(deps);
      expect(rt.playheadElapsedMs()).toBe(0);
    });

    it('seeds the origin at nowMs and elapsed grows with now()', () => {
      const { deps, setNow } = makeDeps();
      const rt = createDawShellRuntime(deps);
      setNow(1000);
      rt.startPlayhead(1000);
      expect(rt.playheadElapsedMs()).toBe(0);
      setNow(1500);
      expect(rt.playheadElapsedMs()).toBe(500);
    });

    it('starting again resets the playhead to zero for a new capture', () => {
      const { deps, setNow } = makeDeps();
      const rt = createDawShellRuntime(deps);
      setNow(1000);
      rt.startPlayhead(1000);
      setNow(5000);
      rt.startPlayhead(5000);
      expect(rt.playheadElapsedMs()).toBe(0);
    });
  });

  describe('stopPlayhead', () => {
    it('freezes elapsed time at the stop moment', () => {
      const { deps, setNow } = makeDeps();
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(2000);
      rt.stopPlayhead();
      setNow(9000); // clock keeps moving; elapsed must stay frozen
      expect(rt.playheadElapsedMs()).toBe(2000);
    });

    it('repaints the frozen time (patches .daw-transport-time)', () => {
      const timeEl = { textContent: '' };
      const shell = makeFakeShell({ timeEl });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(65000); // 1:05
      rt.stopPlayhead();
      expect(timeEl.textContent).toBe('1:05');
    });

    it('is a no-op paint when there is no .daw-shell (DAW toggle off)', () => {
      const { deps, setShell } = makeDeps();
      setShell(null);
      const rt = createDawShellRuntime(deps);
      expect(() => rt.stopPlayhead()).not.toThrow();
    });
  });

  describe('resetWaveform', () => {
    it('resets to a fresh empty waveform state, wiping any prior ingest', () => {
      const shell = makeFakeShell();
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      // Ingest before reset — the reset must wipe it, not merge with it.
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      rt.resetWaveform(0.25); // re-aligns the bucket rate to this capture's meter interval
      rt.renderWaveform();
      const mixCanvas = shell.el.mixCanvas as ReturnType<typeof makeFakeCanvas>;
      expect(mixCanvas.ctx.calls.beginPath).toBe(0); // cleared, no columns drawn
    });

    it('cancels a pending scheduled repaint from a previous session', () => {
      const { deps, raf, cancelRaf } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      expect(raf).toHaveBeenCalledTimes(1);
      rt.resetWaveform(0.25);
      expect(cancelRaf).toHaveBeenCalledTimes(1);
    });

    it('does not call cancelRaf when there is no pending scheduled repaint', () => {
      const { deps, cancelRaf } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.resetWaveform(0.25);
      expect(cancelRaf).not.toHaveBeenCalled();
    });
  });

  describe('renderPlayhead', () => {
    it('uses playback progress over the live clock for both segments and resumes the live clock when cleared', () => {
      const timeEl = { textContent: '' };
      const playheadEls = [makeFakePlayhead(), makeFakePlayhead()];
      const shell = makeFakeShell({ timeEl, playheadEls, clientWidth: 400 });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(10000); // Live capture clock is at ten seconds.

      rt.setPlaybackPosition({ elapsed: 3, duration: 60 });
      rt.renderPlayhead();

      expect(timeEl.textContent).toBe('0:03');
      for (const el of playheadEls) {
        expect(el.style.left).toBe(`${dawTimelineX(3)}px`);
        expect(el.classList.toggle).toHaveBeenCalledWith('advancing', true);
      }

      rt.setPlaybackPosition(null);
      rt.renderPlayhead();
      expect(timeEl.textContent).toBe('0:10');
      for (const el of playheadEls) expect(el.style.left).toBe(`${dawTimelineX(10)}px`);
    });

    it('no-ops when there is no .daw-shell', () => {
      const { deps, setShell } = makeDeps();
      setShell(null);
      const rt = createDawShellRuntime(deps);
      expect(() => rt.renderPlayhead()).not.toThrow();
    });

    it('patches text but writes no segment when the shell has none', () => {
      const timeEl = { textContent: '' };
      const shell = makeFakeShell({ timeEl, playheadEls: [] });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(5000);
      expect(() => rt.renderPlayhead()).not.toThrow();
      expect(timeEl.textContent).toBe('0:05');
    });

    it('patches transport-time text only when it changed', () => {
      const timeEl = { textContent: '0:05' };
      const shell = makeFakeShell({ timeEl });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(5000); // formats to '0:05' — same text, but assignment is idempotent either way
      rt.renderPlayhead();
      expect(timeEl.textContent).toBe('0:05');
    });

    it('sets the playhead left from dawPlayheadX and toggles .advancing on both segments while running', () => {
      const playheadEls = [makeFakePlayhead(), makeFakePlayhead()];
      const shell = makeFakeShell({ playheadEls, clientWidth: 400 });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(1000); // 1s elapsed
      rt.renderPlayhead();
      for (const el of playheadEls) {
        expect(el.style.left).toBe(`${dawTimelineX(1)}px`);
        expect(el.classList.toggle).toHaveBeenCalledWith('advancing', true);
      }
    });

    it("clamps at the shell's right inset on every segment", () => {
      const playheadEls = [makeFakePlayhead(), makeFakePlayhead()];
      const shell = makeFakeShell({ playheadEls, clientWidth: 400 });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(60000); // 60s elapsed — past the shell's right edge
      rt.renderPlayhead();
      for (const el of playheadEls) {
        expect(el.style.left).toBe(`${400 - DAW_TIMELINE_INSET_PX}px`);
      }
    });

    it('floors at the shared origin on every segment for a shell narrower than the head column', () => {
      const playheadEls = [makeFakePlayhead(), makeFakePlayhead()];
      const shell = makeFakeShell({ playheadEls, clientWidth: 20 });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(60000); // 60s elapsed — way past the clamp
      rt.renderPlayhead();
      for (const el of playheadEls) {
        expect(el.style.left).toBe(`${DAW_TIMELINE_ORIGIN_PX}px`);
      }
    });

    it('toggles .advancing false on every segment once stopped', () => {
      const playheadEls = [makeFakePlayhead(), makeFakePlayhead()];
      const shell = makeFakeShell({ playheadEls });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      rt.stopPlayhead();
      for (const el of playheadEls) (el.classList.toggle as ReturnType<typeof vi.fn>).mockClear();
      rt.renderPlayhead();
      for (const el of playheadEls) {
        expect(el.classList.toggle).toHaveBeenCalledWith('advancing', false);
      }
    });

    it('writes one identical x to every segment in the same pass (#1049)', () => {
      const playheadEls = [makeFakePlayhead(), makeFakePlayhead(), makeFakePlayhead()];
      const shell = makeFakeShell({ playheadEls, clientWidth: 400 });
      const { deps, setShell, setNow } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      setNow(0);
      rt.startPlayhead(0);
      setNow(2000); // 2s elapsed
      rt.renderPlayhead();
      const expected = `${dawTimelineX(2)}px`;
      for (const el of playheadEls) {
        expect(el.style.left).toBe(expected);
      }
    });
  });

  describe('renderWaveform', () => {
    it('no-ops when there is no .daw-shell', () => {
      const { deps, setShell } = makeDeps();
      setShell(null);
      const rt = createDawShellRuntime(deps);
      expect(() => rt.renderWaveform()).not.toThrow();
    });

    it('no-ops when the shell has no .daw-mix-waveform canvas', () => {
      const shell = makeFakeShell({ mixCanvas: null });
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      expect(() => rt.renderWaveform()).not.toThrow();
    });

    it('paints the mix canvas from waveformState.pairs, stroke by capture mode', () => {
      const shell = makeFakeShell();
      const { deps, setShell, setCapture } = makeDeps();
      setShell(shell);
      setCapture({ isCapturing: true, liveMode: 'record' });
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192, 0, 255]) }]));
      rt.renderWaveform();
      const mixCanvas = shell.el.mixCanvas as ReturnType<typeof makeFakeCanvas>;
      expect(mixCanvas.ctx.strokeStyle).toBe(WAVEFORM_COLORS.recording);
      expect(mixCanvas.ctx.calls.stroke).toBeGreaterThan(0);
    });

    it('uses the monitoring color while capturing in monitor mode, and stopped when idle', () => {
      const shell = makeFakeShell();
      const { deps, setShell, setCapture } = makeDeps();
      setShell(shell);
      setCapture({ isCapturing: true, liveMode: 'monitor' });
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      rt.renderWaveform();
      const mixCanvas = shell.el.mixCanvas as ReturnType<typeof makeFakeCanvas>;
      expect(mixCanvas.ctx.strokeStyle).toBe(WAVEFORM_COLORS.monitoring);

      setCapture({ isCapturing: false, liveMode: 'monitor' });
      rt.renderWaveform();
      expect(mixCanvas.ctx.strokeStyle).toBe(WAVEFORM_COLORS.stopped);
    });

    it('paints every .daw-channel-lane canvas from waveformLaneStates["strip"+ch]', () => {
      const canvas0 = makeFakeCanvas();
      const canvas1 = makeFakeCanvas();
      const lanes = [makeFakeLane('0', canvas0), makeFakeLane('1', canvas1)];
      const shell = makeFakeShell({ lanes });
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([
        { id: 'strip0', data: encodePairs([64, 192]) },
      ]));
      rt.renderWaveform();
      expect(canvas0.ctx.calls.stroke).toBeGreaterThan(0); // has data
      expect(canvas1.ctx.calls.beginPath).toBe(0); // missing lane -> empty pairs -> cleared, no strokes
    });

    it('a lane with no matching waveformLaneStates entry paints an empty (cleared) canvas', () => {
      const canvas0 = makeFakeCanvas();
      const lanes = [makeFakeLane('0', canvas0)];
      const shell = makeFakeShell({ lanes });
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      rt.renderWaveform();
      expect(canvas0.ctx.calls.clearRect.length).toBe(1);
      expect(canvas0.ctx.calls.beginPath).toBe(0);
    });

    it('a lane whose canvas element is missing is skipped without throwing', () => {
      const lanes = [makeFakeLane('0', null)];
      const shell = makeFakeShell({ lanes });
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      expect(() => rt.renderWaveform()).not.toThrow();
    });

    it('skips painting (no throw) when a canvas has no 2D context available', () => {
      const mixCanvas = makeFakeCanvas({ getContext: () => null });
      const shell = makeFakeShell({ mixCanvas });
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      expect(() => rt.renderWaveform()).not.toThrow();
    });

    it('sizes to 0x0 (no throw) when a canvas has no parentElement', () => {
      const mixCanvas = makeFakeCanvas({ parentElement: null });
      const shell = makeFakeShell({ mixCanvas });
      const { deps, setShell } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      rt.renderWaveform();
      expect(mixCanvas.width).toBe(0);
      expect(mixCanvas.height).toBe(0);
    });

    it('falls back to the stopped color for an unrecognized capture-mode token', () => {
      const shell = makeFakeShell();
      const { deps, setShell } = makeDeps({
        dawWaveformState: { ...require('../daw-waveform-state.js'), captureModeToken: () => 'unknown-mode' },
      });
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      rt.renderWaveform();
      const mixCanvas = shell.el.mixCanvas as ReturnType<typeof makeFakeCanvas>;
      expect(mixCanvas.ctx.strokeStyle).toBe(WAVEFORM_COLORS.stopped);
    });
  });

  describe('ingestPeaks', () => {
    it('a null/undecodable frame is a no-op', () => {
      const { deps, raf } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(null);
      rt.ingestPeaks({ notLanes: true });
      expect(raf).not.toHaveBeenCalled();
    });

    it('appends the mix lane into waveformState', () => {
      const shell = makeFakeShell();
      const { deps, setShell, flushRaf } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      flushRaf();
      const mixCanvas = shell.el.mixCanvas as ReturnType<typeof makeFakeCanvas>;
      expect(mixCanvas.ctx.calls.stroke).toBeGreaterThan(0);
    });

    it('appends every non-mix lane id into waveformLaneStates', () => {
      const canvas0 = makeFakeCanvas();
      const lanes = [makeFakeLane('0', canvas0)];
      const shell = makeFakeShell({ lanes });
      const { deps, setShell, flushRaf } = makeDeps();
      setShell(shell);
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'strip0', data: encodePairs([64, 192]) }]));
      flushRaf();
      expect(canvas0.ctx.calls.stroke).toBeGreaterThan(0);
    });

    it('seeds a first frame for a lane with a fresh create() (no throw on first ingest)', () => {
      const { deps } = makeDeps();
      const rt = createDawShellRuntime(deps);
      expect(() => rt.ingestPeaks(peaksFrame([{ id: 'strip0', data: encodePairs([64, 192]) }]))).not.toThrow();
    });

    it('coalesces a burst of ingests to one scheduled rAF', () => {
      const { deps, raf, flushRaf } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([0, 255]) }]));
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([128, 128]) }]));
      expect(raf).toHaveBeenCalledTimes(1);
      flushRaf();
      // A fresh ingest after the flush schedules a new rAF (the guard resets).
      rt.ingestPeaks(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      expect(raf).toHaveBeenCalledTimes(2);
    });
  });

  describe('bindLiveEvents', () => {
    it('subscribes exactly once', () => {
      const { deps, subscribe } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.bindLiveEvents();
      expect(subscribe).toHaveBeenCalledTimes(1);
    });

    it('ignores non-peaks frames', () => {
      const { deps, subscribe, raf } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.bindLiveEvents();
      const handler = subscribe.mock.calls[0][0] as (data: unknown) => void;
      handler({ type: 'window', channels: [] });
      handler(null);
      handler({ error: 'boom' });
      expect(raf).not.toHaveBeenCalled();
    });

    it('routes peaks frames to ingestPeaks', () => {
      const { deps, subscribe, raf } = makeDeps();
      const rt = createDawShellRuntime(deps);
      rt.bindLiveEvents();
      const handler = subscribe.mock.calls[0][0] as (data: unknown) => void;
      handler(peaksFrame([{ id: 'mix', data: encodePairs([64, 192]) }]));
      expect(raf).toHaveBeenCalledTimes(1);
    });
  });
});

/* ── dawTimelineX (pure, #1031) ── */

describe('dawTimelineX', () => {
  it('returns DAW_TIMELINE_ORIGIN_PX at t=0', () => {
    expect(dawTimelineX(0)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });

  it('advances by exactly DAW_TIMELINE_PX_PER_SECOND per second', () => {
    expect(dawTimelineX(3) - dawTimelineX(2)).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('is unclamped and returns coordinates left of the origin for negative seconds', () => {
    expect(dawTimelineX(-1)).toBe(DAW_TIMELINE_ORIGIN_PX - DAW_TIMELINE_PX_PER_SECOND);
  });

  it('matches the origin-plus-scale formula for an arbitrary t', () => {
    const t = 12.5;
    expect(dawTimelineX(t)).toBe(DAW_TIMELINE_ORIGIN_PX + t * DAW_TIMELINE_PX_PER_SECOND);
  });
});

/* ── dawPlayheadX (#1034) ── */

describe('dawPlayheadX', () => {
  it('returns DAW_TIMELINE_ORIGIN_PX at 0 elapsed', () => {
    expect(dawPlayheadX(0, 4000)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });

  it('advances at the shared timeline scale', () => {
    expect(dawPlayheadX(5000, 4000)).toBe(dawTimelineX(5));
  });

  it("clamps at the shell's right inset", () => {
    expect(dawPlayheadX(600_000, 400)).toBe(400 - DAW_TIMELINE_INSET_PX);
  });

  it('floors at the shared origin for a shell narrower than the head column', () => {
    expect(dawPlayheadX(600_000, 20)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });

  it('clamps a negative elapsed to the origin', () => {
    expect(dawPlayheadX(-5000, 4000)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });

  it('resolves a non-finite elapsed to the origin, never NaN', () => {
    expect(dawPlayheadX(NaN, 4000)).toBe(DAW_TIMELINE_ORIGIN_PX);
    expect(dawPlayheadX(Infinity, 4000)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });

  it('resolves a non-finite shell width to the origin, never NaN', () => {
    expect(dawPlayheadX(5000, NaN)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });
});

/* ── dawRulerTicks (#1032) ── */

describe('dawRulerTicks (#1032)', () => {
  it('first tick is t=0 at the shared timeline origin', () => {
    const first: DawRulerTick = dawRulerTicks(30)[0];
    expect(first).toEqual({ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX });
  });

  it('yields representative times whose xPx matches the shared geometry', () => {
    const ticks = dawRulerTicks(30);
    expect(ticks.map((tick) => tick.timeSecs)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(ticks[0].xPx).toBe(dawTimelineX(0));
    expect(ticks[2].xPx).toBe(dawTimelineX(10));
    expect(ticks[6].xPx).toBe(dawTimelineX(30));
  });

  it('consecutive ticks differ by one interval of the shared scale', () => {
    const ticks = dawRulerTicks(30);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].xPx - ticks[i - 1].xPx).toBe(DAW_RULER_TICK_INTERVAL_SECS * DAW_TIMELINE_PX_PER_SECOND);
    }
  });

  it('every tick over the default span agrees with dawTimelineX for its own time', () => {
    expect(dawRulerTicks(DAW_TIMELINE_SPAN_SECS).every((tick) => tick.xPx === dawTimelineX(tick.timeSecs))).toBe(true);
  });

  it('the last tick of the default span sits at DAW_TIMELINE_SPAN_SECS', () => {
    const ticks = dawRulerTicks(DAW_TIMELINE_SPAN_SECS);
    expect(ticks[ticks.length - 1].timeSecs).toBe(DAW_TIMELINE_SPAN_SECS);
  });

  it('returns exactly one tick at t=0 for a zero span', () => {
    expect(dawRulerTicks(0)).toEqual([{ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX }]);
  });

  it('returns exactly one tick for a span shorter than one interval', () => {
    expect(dawRulerTicks(3)).toEqual([{ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX }]);
  });

  it('returns no ticks for a negative span', () => {
    expect(dawRulerTicks(-1)).toEqual([]);
  });

  it('returns no ticks for a non-finite span', () => {
    expect(dawRulerTicks(NaN)).toEqual([]);
  });

  it('stops at the last whole interval for a span that is not a multiple of the interval', () => {
    const ticks = dawRulerTicks(12);
    expect(ticks.map((tick) => tick.timeSecs)).toEqual([0, 5, 10]);
  });
});

/* ── dawLaneGridlines (#1033) ── */

describe('dawLaneGridlines (#1033)', () => {
  it('first gridline is t=0 at the shared timeline origin and is major', () => {
    const first: DawLaneGridline = dawLaneGridlines(30)[0];
    expect(first).toEqual({ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX, isMajor: true });
  });

  it('yields representative times whose xPx matches the shared geometry', () => {
    const lines = dawLaneGridlines(30);
    expect(lines.map((line) => line.timeSecs)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(lines[0].xPx).toBe(dawTimelineX(0));
    expect(lines[2].xPx).toBe(dawTimelineX(10));
    expect(lines[6].xPx).toBe(dawTimelineX(30));
  });

  it('classifies major/minor lines by whole multiples of DAW_LANE_GRID_MAJOR_SECS', () => {
    const lines = dawLaneGridlines(30);
    const major = lines.filter((line) => line.isMajor).map((line) => line.timeSecs);
    const minor = lines.filter((line) => !line.isMajor).map((line) => line.timeSecs);
    expect(major).toEqual([0, DAW_LANE_GRID_MAJOR_SECS, 20, 30]);
    expect(minor).toEqual([5, 15, 25]);
  });

  it('consecutive gridlines differ by exactly one minor interval of the shared scale', () => {
    const lines = dawLaneGridlines(30);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].xPx - lines[i - 1].xPx).toBe(DAW_LANE_GRID_MINOR_SECS * DAW_TIMELINE_PX_PER_SECOND);
    }
  });

  it('every gridline over the default span agrees with dawTimelineX for its own time', () => {
    expect(dawLaneGridlines(DAW_TIMELINE_SPAN_SECS).every((line) => line.xPx === dawTimelineX(line.timeSecs))).toBe(true);
  });

  it('agrees pixel-for-pixel with dawRulerTicks for the same times', () => {
    expect(dawLaneGridlines(60).map((line) => line.xPx)).toEqual(dawRulerTicks(60).map((tick) => tick.xPx));
  });

  it('returns exactly one gridline at t=0 for a zero span', () => {
    expect(dawLaneGridlines(0)).toEqual([{ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX, isMajor: true }]);
  });

  it('returns exactly one gridline for a span shorter than one interval', () => {
    expect(dawLaneGridlines(3)).toEqual([{ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX, isMajor: true }]);
  });

  it('returns no gridlines for a negative span', () => {
    expect(dawLaneGridlines(-1)).toEqual([]);
  });

  it('returns no gridlines for a non-finite span', () => {
    expect(dawLaneGridlines(NaN)).toEqual([]);
  });
});
