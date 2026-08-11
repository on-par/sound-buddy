// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Playback-transport module (TD-001 slice 6a, #695): the pure seek/frame/
// readout math plus a DOM-side-effect-injected <audio> lifecycle controller,
// ported verbatim from inline-app.js's playback-transport block
// (ensurePlaybackAudio/releasePlaybackAudio/pauseTransportAudio/
// onPlaybackEnded/seekPlayback/startPlaybackBandLoop/stopPlaybackBandLoop) so
// the element's lifecycle, seek clamping, and frame math are unit-tested
// without a DOM (see the ADR in the #695 plan). The ~60 Hz tick listener
// deliberately does NOT flow through React state — SpectrogramScrubber wires
// it straight to refs — so playback stays smooth and CSS bar transitions
// keep animating (see the ADR).

import { fmt } from './report-card';
import { fmtDur, classLabel, formatClock, type SpectrumFrame } from './spectrum-display';
import { getSoundBuddy } from './useElectron';

export const PLAYBACK_AVG_WINDOW_SEC = 0.5; // trailing window for the "window avg" readout
// Clamp below the real duration: setting currentTime AT duration reads back as
// "reached the end" to Chromium, which re-fires 'ended' and immediately snaps
// back to 0 — seeking near the final frame would silently undo itself.
export const SEEK_END_GUARD_SEC = 0.05;

export function clampSeekTime(t: number, duration: number): number {
  return duration > 0 ? Math.min(t, Math.max(0, duration - SEEK_END_GUARD_SEC)) : t;
}

export function resolveDuration(audioDuration: number | undefined, fallbackSeconds: number): number {
  return Number.isFinite(audioDuration) && (audioDuration as number) > 0 ? (audioDuration as number) : (fallbackSeconds || 0);
}

// Nearest frame for a playback position — the same t→x proportion the
// heatmap playhead uses, so the animated bars always match the frame the
// playhead is currently over.
export function frameIndexAtTime(frames: SpectrumFrame[], t: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(frames.length - 1, Math.floor((t / total) * frames.length)));
}

// Mean of frame.rms over the trailing [t - windowSec, t] window.
export function windowAverageRms(frames: SpectrumFrame[], t: number, windowSec: number): number | null {
  let sum = 0, n = 0;
  for (const f of frames) if (f.t <= t && f.t > t - windowSec && Number.isFinite(f.rms)) { sum += f.rms as number; n++; }
  return n ? sum / n : null;
}

export function frameIndexFromClick(clientX: number, boxLeft: number, boxWidth: number, frameCount: number): number | null {
  if (!(boxWidth > 0) || !(frameCount > 0)) return null;
  return Math.max(0, Math.min(frameCount - 1, Math.floor(((clientX - boxLeft) / boxWidth) * frameCount)));
}

// Arrow-key nudge increment for the playback transport (#754).
export const SEEK_NUDGE_SEC = 5;

// Continuous seek target (seconds) for a click/drag at clientX on a full-width
// seek bar. Unlike frameIndexFromClick this is NOT quantized to frame columns —
// the whole point of the bar is landing anywhere. Returns null for a zero-width
// bar or an unknown duration; the fraction is clamped to [0,1].
export function seekTimeFromBarClick(
  clientX: number,
  boxLeft: number,
  boxWidth: number,
  duration: number,
): number | null {
  if (!(boxWidth > 0) || !(duration > 0)) return null;
  const frac = Math.max(0, Math.min(1, (clientX - boxLeft) / boxWidth));
  return frac * duration;
}

// New playhead time for an arrow-key nudge, or null if `key` isn't a seek key.
// Floors at 0; the caller's seek() applies the upper-bound end guard via
// clampSeekTime, so no duration argument is needed here.
export function seekNudgeTarget(
  key: string,
  currentTime: number,
  nudgeSec: number = SEEK_NUDGE_SEC,
): number | null {
  if (key === 'ArrowLeft') return Math.max(0, currentTime - nudgeSec);
  if (key === 'ArrowRight') return currentTime + nudgeSec;
  return null;
}

export function playheadPercent(currentTime: number, duration: number): number {
  return duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) * 100 : 0;
}

export function playbackClockText(currentTime: number, duration: number): string {
  return `${formatClock(currentTime)} / ${formatClock(duration)}`;
}

export function scrubReadoutText(frame: SpectrumFrame | null): string {
  if (!frame) return 'Whole-file average';
  // fmt's parameter is typed `number`, but (mirroring inline-app.js's original
  // untyped call) a frame with no rms measurement still renders via fmt's own
  // !isFinite(undefined) guard rather than needing a separate branch here.
  return `t = ${fmtDur(frame.t)} · ${classLabel(frame.class)} · RMS ${fmt(frame.rms as number)} dB`;
}

export function playbackReadoutText(frameClass: string | undefined, avgRms: number | null): string {
  return classLabel(frameClass) + (avgRms != null ? ` · Window avg ${fmt(avgRms)} dB` : '');
}

export function clampSelectedFrame(selected: number | null, frameCount: number): number | null {
  return selected != null && selected >= 0 && selected < frameCount ? selected : null;
}

// Narrows the `unknown` analysis payload (TD-011) to just what the transport
// needs: the analyzed file's path and an ffprobe-derived fallback duration for
// use before the <audio> element's own metadata has loaded.
export function analysisPlaybackInputs(analysis: unknown): { filePath: string | null; fallbackDuration: number } {
  if (typeof analysis !== 'object' || analysis === null) return { filePath: null, fallbackDuration: 0 };
  const a = analysis as { filePath?: unknown; ffprobe?: { format?: { durationSeconds?: unknown } } };
  const filePath = typeof a.filePath === 'string' ? a.filePath : null;
  const durationSeconds = a.ffprobe?.format?.durationSeconds;
  const fallbackDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? durationSeconds : 0;
  return { filePath, fallbackDuration };
}

/* ── <audio> lifecycle controller ── */

export interface TransportAudio {
  paused: boolean;
  ended: boolean;
  currentTime: number;
  readonly duration: number;
  src: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (evt?: { target?: unknown }) => void): void;
}

export interface SpectrumTransportDeps {
  createAudio(url: string): TransportAudio;
  toFileUrl(filePath: string): Promise<string | null>;
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
}

export interface SpectrumTransport {
  ensure(filePath: string): Promise<void>;
  reset(): void;
  pauseIfPlaying(): void;
  toggle(): void;
  seek(seconds: number): void;
  isPlaying(): boolean;
  currentTime(): number;
  duration(): number;
  setFallbackDuration(seconds: number): void;
  /** Discrete changes (play / pause / ended / loadedmetadata / timeupdate / seek / error). */
  subscribe(listener: () => void): () => void;
  /** ~60 Hz while playing. Never routed through React state — see the ADR. */
  onTick(listener: (currentTime: number) => void): () => void;
}

export function createSpectrumTransport(deps: SpectrumTransportDeps): SpectrumTransport {
  let audio: TransportAudio | null = null;
  let path: string | null = null;
  // Bumped on every ensure() call so a call superseded by a newer one can't
  // win the toFileUrl race and stomp audio/path with a stale file's data
  // after a fresher call (or a reset()) already committed.
  let generation = 0;
  let fallbackDuration = 0;
  let rafHandle: number | null = null;
  const subscribers = new Set<() => void>();
  const tickListeners = new Set<(t: number) => void>();

  function notify(): void { subscribers.forEach((l) => l()); }

  function stopLoop(): void {
    if (rafHandle != null) { deps.cancelRaf(rafHandle); rafHandle = null; }
  }

  function startLoop(): void {
    if (rafHandle != null || !audio) return;
    const tick = (): void => {
      if (!audio || audio.paused || audio.ended) { rafHandle = null; return; }
      const t = audio.currentTime;
      tickListeners.forEach((l) => l(t));
      rafHandle = deps.raf(tick);
    };
    rafHandle = deps.raf(tick);
  }

  function releaseAudio(): void {
    if (audio) { audio.pause(); audio.src = ''; }
    audio = null;
    stopLoop();
  }

  async function ensure(filePath: string): Promise<void> {
    if (path === filePath) return;
    const gen = ++generation;
    // toFileUrl is IPC-backed, so this crosses a round-trip before the <audio>
    // element exists.
    const url = await deps.toFileUrl(filePath);
    if (gen !== generation) return; // superseded — a newer call (or reset()) already won
    releaseAudio();
    path = filePath;
    // Null when the file is gone (moved/deleted since analysis) — leave audio
    // unset rather than pointing <audio> at a dead path.
    if (!url) return;
    const a = deps.createAudio(url);
    // evt.target lets a stale instance's pause/ended (fired after a newer
    // ensure() already swapped `audio` out from under it) be ignored, so it
    // can't cancel a newer file's live rAF loop.
    a.addEventListener('timeupdate', () => notify());
    a.addEventListener('loadedmetadata', () => notify());
    a.addEventListener('play', () => { notify(); startLoop(); });
    a.addEventListener('pause', (evt) => {
      if (evt && evt.target !== audio) return;
      notify();
      stopLoop();
    });
    a.addEventListener('ended', (evt) => {
      if (evt && evt.target !== audio) return;
      a.currentTime = 0;
      notify();
      stopLoop();
    });
    // An undecodable source (e.g. some AIFF variants sox/ffprobe accept but
    // Chromium's <audio> can't) fails quietly instead of an uncaught rejection.
    a.addEventListener('error', () => notify());
    audio = a;
  }

  function reset(): void {
    releaseAudio();
    path = null;
    generation++; // invalidate any in-flight ensure()
  }

  function pauseIfPlaying(): void {
    if (audio && !audio.paused) audio.pause();
  }

  function toggle(): void {
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => notify());
    else audio.pause();
  }

  function duration(): number {
    return resolveDuration(audio?.duration, fallbackDuration);
  }

  function seek(t: number): void {
    if (!audio) return;
    audio.currentTime = clampSeekTime(t, duration());
    notify();
  }

  function isPlaying(): boolean {
    return !!audio && !audio.paused && !audio.ended;
  }

  function currentTime(): number {
    return audio ? audio.currentTime : 0;
  }

  function setFallbackDuration(seconds: number): void {
    fallbackDuration = seconds;
  }

  function subscribe(listener: () => void): () => void {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function onTick(listener: (t: number) => void): () => void {
    tickListeners.add(listener);
    return () => tickListeners.delete(listener);
  }

  return {
    ensure, reset, pauseIfPlaying, toggle, seek, isPlaying, currentTime, duration,
    setFallbackDuration, subscribe, onTick,
  };
}

// Real-dependency singleton, installed onto window.spectrumTransport by
// installStoreBridge (bridge.ts) so inline-app.js can drive it by name.
/* c8 ignore start -- thin real-dependency wiring (new Audio(), the real IPC
   bridge, requestAnimationFrame/cancelAnimationFrame), no jsdom in this
   harness — exercised by tests/e2e/playback-transport.spec.ts.
   createSpectrumTransport's own logic (everything these deps get called
   into) is exhaustively unit-tested above against a fake TransportAudio. */
export const spectrumTransport: SpectrumTransport = createSpectrumTransport({
  createAudio: (url) => new Audio(url),
  toFileUrl: (filePath) => getSoundBuddy().toFileUrl(filePath),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (handle) => cancelAnimationFrame(handle),
});
/* c8 ignore stop */
