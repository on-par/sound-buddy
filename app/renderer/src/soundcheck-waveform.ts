// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free per-track waveform lane model + draw for the Virtual
// Soundcheck tab (story 3, #735): one Ableton-arrangement-style lane per
// session track, all sharing one horizontal time axis. Decodes the ADR-0004
// min/max peak documents #734's generateSessionPeaks pipeline produced
// (docs/adr/0004-waveform-peak-transport.md — the same encoding
// daw-waveform-state.js's decodeLaneData mirrors: QUANT_LEVELS=256, min/max
// interleaved u8 bytes per bucket, base64) and draws each lane to an injected
// canvas context. ADR-0014: a stereo stem folds to ONE combined lane per
// track — there are no per-channel sub-lanes, and the draw path is
// kind-agnostic. No DOM, no Electron — soundcheck-panel.ts's view-model
// pattern, with share-card.ts's structural CanvasLike for the draw side so
// the whole module is unit-testable under Vitest.

import type { SessionPeaksDto } from '../../electron/ipc/api';

/** One decoded min/max peak bucket, both values in [-1, 1]. */
export interface WaveformPeakPair {
  min: number;
  max: number;
}

/** One drawable waveform lane — a track's decoded pairs (ADR-0014: exactly
 *  one combined lane per track, whatever the kind). */
export interface SoundcheckWaveformLane {
  index: number; // TrackPeaksDto.index
  label: string; // TrackPeaksDto.label
  kind: 'mono' | 'stereo'; // carried through for the mono/stereo contract; the draw is kind-agnostic
  pairs: WaveformPeakPair[]; // decoded from TrackPeaksDto.data
}

/** The shared-timeline view model built from a session's peaks document. */
export interface SoundcheckWaveformTimeline {
  bucketsPerSecond: number; // SessionPeaksDto.bucketsPerSecond
  sessionDurationSecs: number; // max decoded pairs / bucketsPerSecond — the shared axis length
  lanes: SoundcheckWaveformLane[]; // one per track with decodable data
}

/** The subset of CanvasRenderingContext2D that drawSoundcheckWaveform uses —
 *  a local structural type (share-card.ts's CanvasLike precedent) so a
 *  recording fake satisfies it in tests without `any` and without a DOM
 *  canvas. */
export interface WaveformCanvasLike {
  strokeStyle: string;
  lineWidth: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

// Must match waveform_peaks.py's QUANT_LEVELS (ADR-0004): u8 quantization of
// a peak value in [-1.0, 1.0].
const QUANT_LEVELS = 256;

// The waveform stroke color — literal #EBB93C mirroring the --gold-500 token
// the existing .sc-meter-fill uses (canvas cannot resolve CSS custom
// properties, same rationale as inline-app.js's WAVEFORM_COLORS).
export const WAVEFORM_LANE_HEX = '#EBB93C';

/** Decode one track's ADR-0004 base64 `data` into {min, max} pairs in [-1,
 *  1]. Returns null for non-string, empty, non-base64 (atob throws → caught),
 *  or odd byte length — a truncated document must never throw in the render
 *  path (mirrors daw-waveform-state.js's decodeLaneData resilience). */
export function decodePeaksPairs(data: string): WaveformPeakPair[] | null {
  if (typeof data !== 'string' || data.length === 0) return null;
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length % 2 !== 0) return null;
  const pairs: WaveformPeakPair[] = [];
  for (let j = 0; j < binary.length; j += 2) {
    const minLevel = binary.charCodeAt(j);
    const maxLevel = binary.charCodeAt(j + 1);
    pairs.push({
      min: (minLevel / (QUANT_LEVELS - 1)) * 2 - 1,
      max: (maxLevel / (QUANT_LEVELS - 1)) * 2 - 1,
    });
  }
  return pairs;
}

/** Build the shared-timeline lane model for a session's peaks document.
 *  Returns null when peaks is null, has no tracks, or bucketsPerSecond is
 *  non-finite/<= 0 (division guard). Each track decodes into one lane
 *  (ADR-0014); a malformed lane is skipped without nulling the session, and
 *  sessionDurationSecs is driven by the LONGEST decoded track so every lane
 *  shares one horizontal axis aligned at x=0. Null when every lane is
 *  malformed. */
export function sessionPeakTimeline(peaks: SessionPeaksDto | null): SoundcheckWaveformTimeline | null {
  if (!peaks) return null;
  if (!Array.isArray(peaks.tracks) || peaks.tracks.length === 0) return null;
  if (!isFinite(peaks.bucketsPerSecond) || peaks.bucketsPerSecond <= 0) return null;

  const lanes: SoundcheckWaveformLane[] = [];
  let maxBuckets = 0;
  for (const track of peaks.tracks) {
    const pairs = decodePeaksPairs(track.data);
    if (!pairs) continue; // skip one bad lane, keep the rest (ADR-0014 / daw-waveform-state rule)
    maxBuckets = Math.max(maxBuckets, pairs.length);
    lanes.push({ index: track.index, label: track.label, kind: track.kind, pairs });
  }
  if (lanes.length === 0) return null;
  return {
    bucketsPerSecond: peaks.bucketsPerSecond,
    sessionDurationSecs: maxBuckets / peaks.bucketsPerSecond,
    lanes,
  };
}

/** Per-pixel-column {min, max} aggregates for drawing (same geometry as
 *  daw-waveform-state.js's columnPeaks): column x covers buckets
 *  [x * bucketsPerSecond / pxPerSecond, (x+1) * ...), aggregating
 *  min-of-mins/max-of-maxes. Returns at most Math.floor(widthPx) columns and
 *  stops at the last bucket, so a short track ends early. min/max are
 *  initialized from the first in-range bucket — no Infinity sentinel, so no
 *  unreachable fallback branch. Returns [] for empty pairs or non-positive
 *  widthPx/pxPerSecond. */
export function waveformColumns(
  pairs: WaveformPeakPair[],
  bucketsPerSecond: number,
  pxPerSecond: number,
  widthPx: number,
): WaveformPeakPair[] {
  if (pairs.length === 0 || widthPx <= 0 || pxPerSecond <= 0) return [];
  const bucketsPerPx = bucketsPerSecond / pxPerSecond;
  const totalCols = Math.floor(widthPx);
  const out: WaveformPeakPair[] = [];
  for (let x = 0; x < totalCols; x++) {
    const startBucket = x * bucketsPerPx;
    if (startBucket >= pairs.length) break;
    const endBucket = Math.min(pairs.length, (x + 1) * bucketsPerPx);
    const startIdx = Math.floor(startBucket);
    const endIdx = Math.max(startIdx + 1, Math.ceil(endBucket));
    let min = pairs[startIdx].min;
    let max = pairs[startIdx].max;
    for (let i = startIdx + 1; i < endIdx && i < pairs.length; i++) {
      if (pairs[i].min < min) min = pairs[i].min;
      if (pairs[i].max > max) max = pairs[i].max;
    }
    out.push({ min, max });
  }
  return out;
}

/** Draw one lane's waveform to the injected context: one 1px vertical stroke
 *  per pixel column at the shared pxPerSecond scale. clearRect first, then
 *  return early for a zero-size canvas or no columns. Silence still draws a
 *  min-1px-tall hairline (yBottom = max(yTop + 1, ...) — the inline-app.js
 *  drawWaveformLane rule). No `kind` anywhere: the single-lane draw is
 *  identical for mono and stereo (ADR-0014). */
export function drawSoundcheckWaveform(
  ctx: WaveformCanvasLike,
  pairs: WaveformPeakPair[],
  bucketsPerSecond: number,
  pxPerSecond: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0) return;
  const columns = waveformColumns(pairs, bucketsPerSecond, pxPerSecond, width);
  if (columns.length === 0) return;
  ctx.strokeStyle = WAVEFORM_LANE_HEX;
  ctx.lineWidth = 1;
  const midY = height / 2;
  for (let x = 0; x < columns.length; x++) {
    const col = columns[x];
    const yTop = midY - col.max * midY;
    const yBottom = Math.max(yTop + 1, midY - col.min * midY);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, yTop);
    ctx.lineTo(x + 0.5, yBottom);
    ctx.stroke();
  }
}
