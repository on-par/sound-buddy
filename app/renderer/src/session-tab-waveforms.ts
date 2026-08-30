// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Discrete cached-take view for the Session arrangement (#1072). This joins
// captured-session provenance to the current strip layout; canvas paint stays
// imperative so decoded peaks never enter React or Zustand animation state.

import type { SessionPeaksDto } from '../../electron/ipc/api';
import type { StripConfig } from './live-capture-panel';
import type { SessionManifest } from './soundcheck-panel';
import type { SoundcheckState } from './stores/soundcheckStore';
import { decodePeaksPairs, waveformColumns, type WaveformPeakPair } from './soundcheck-waveform';
import { WAVEFORM_COLORS, drawDawWaveformLane, type DawWaveformCanvasLike } from './daw-shell-runtime';
import { createTimelineScale, type TimelineScale } from './timeline-scale';

export type SessionPeakStatus = SoundcheckState['peaksStatus'];

// The fixed scale every current caller gets. createTimelineScale('default') is provably
// identical to dawTimelineX (ADR-0100), so this is a wiring change, not a behavior change.
const DEFAULT_TIMELINE_SCALE = createTimelineScale('default');

// A cached take always begins at the session's t=0 edge — its first peak bucket is the
// first frame of the recording. Named so the clip's start/end geometry reads as two
// time-to-x conversions rather than one conversion and a bare literal.
const LOADED_TAKE_START_SECS = 0;

export interface SessionTabWaveformClip {
  trackIndex: number;
  stripIndex: number;
  leftPx: number;
  widthPx: number;
  /** The scale this clip's leftPx/widthPx were derived at. The painter aggregates the
   *  clip's peak buckets at exactly this value, so columns can never be sized at a
   *  different scale than the clip that contains them. */
  pxPerSecond: number;
  pairs: WaveformPeakPair[];
  bucketsPerSecond: number;
}

export interface SessionTabWaveformView {
  generating: boolean;
  clips: SessionTabWaveformClip[];
}

function sameChannels(a: number[] | undefined, b: number[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((channel, index) => channel === b[index]);
}

function stripSourceChannels(strip: StripConfig): number[] {
  return strip.kind === 'stereo' ? [strip.a, strip.b] : [strip.a];
}

function isManifestTrack(value: unknown): value is { kind: 'mono' | 'stereo'; sourceChannels?: number[] } {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as { kind?: unknown; sourceChannels?: unknown };
  return (track.kind === 'mono' || track.kind === 'stereo')
    && (track.sourceChannels === undefined || Array.isArray(track.sourceChannels));
}

interface PeakTrack {
  index: number;
  kind: 'mono' | 'stereo';
  bucketCount: number;
  data: string;
}

function isPeakTrack(value: unknown): value is PeakTrack {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as { index?: unknown; kind?: unknown; bucketCount?: unknown; data?: unknown };
  return Number.isInteger(track.index)
    && (track.kind === 'mono' || track.kind === 'stereo')
    && typeof track.bucketCount === 'number'
    && Number.isInteger(track.bucketCount)
    && track.bucketCount >= 0
    && typeof track.data === 'string';
}

function peakTracksByIndex(
  tracks: unknown[],
  manifestTrackCount: number,
): Map<number, PeakTrack> | null {
  const byIndex = new Map<number, PeakTrack>();
  for (const track of tracks) {
    if (!isPeakTrack(track) || track.index < 0 || track.index >= manifestTrackCount || byIndex.has(track.index)) return null;
    byIndex.set(track.index, track);
  }
  return byIndex;
}

export function sessionTabWaveformView(
  manifest: SessionManifest | null,
  peaks: SessionPeaksDto | null,
  peaksStatus: SessionPeakStatus,
  channelConfig: StripConfig[],
  scale: TimelineScale = DEFAULT_TIMELINE_SCALE,
): SessionTabWaveformView {
  const generating = manifest !== null && peaksStatus === 'generating';
  if (!manifest || !Array.isArray(manifest.tracks) || !peaks || !Array.isArray(peaks.tracks) || !Number.isFinite(peaks.bucketsPerSecond) || peaks.bucketsPerSecond <= 0) {
    return { generating, clips: [] };
  }
  const peakTracks = peakTracksByIndex(peaks.tracks, manifest.tracks.length);
  if (!peakTracks) return { generating, clips: [] };

  const candidateClips: SessionTabWaveformClip[] = [];
  for (let trackIndex = 0; trackIndex < manifest.tracks.length; trackIndex++) {
    const manifestTrack = manifest.tracks[trackIndex];
    const peakTrack = peakTracks.get(trackIndex);
    if (!isManifestTrack(manifestTrack) || !peakTrack || peakTrack.kind !== manifestTrack.kind) continue;
    const pairs = decodePeaksPairs(peakTrack.data);
    if (!pairs || peakTrack.bucketCount !== pairs.length) continue;
    const matches = channelConfig
      .map((strip, stripIndex) => ({ strip, stripIndex }))
      .filter(({ strip }) => strip.kind === manifestTrack.kind && sameChannels(manifestTrack.sourceChannels, stripSourceChannels(strip)));
    if (matches.length !== 1) continue;
    const endSecs = LOADED_TAKE_START_SECS + pairs.length / peaks.bucketsPerSecond;
    candidateClips.push({
      trackIndex,
      stripIndex: matches[0].stripIndex,
      leftPx: scale.timeToX(LOADED_TAKE_START_SECS),
      widthPx: scale.timeToX(endSecs) - scale.timeToX(LOADED_TAKE_START_SECS),
      pxPerSecond: scale.pxPerSecond,
      pairs,
      bucketsPerSecond: peaks.bucketsPerSecond,
    });
  }
  const claimsByStrip = new Map<number, number>();
  for (const clip of candidateClips) {
    claimsByStrip.set(clip.stripIndex, (claimsByStrip.get(clip.stripIndex) ?? 0) + 1);
  }
  return { generating, clips: candidateClips.filter((clip) => claimsByStrip.get(clip.stripIndex) === 1) };
}

/** The loaded take's duration in seconds — the widest cached clip's width
 *  converted back through the pxPerSecond that clip was sized at (ADR-0102),
 *  so it can never disagree with the clip geometry on screen. 0 when nothing
 *  is loaded, or when every clip's geometry is degenerate. */
export function sessionTakeDurationSecs(view: SessionTabWaveformView | null): number {
  if (!view) return 0;
  let longest = 0;
  for (const clip of view.clips) {
    if (!Number.isFinite(clip.widthPx) || !Number.isFinite(clip.pxPerSecond) || clip.pxPerSecond <= 0) continue;
    const secs = clip.widthPx / clip.pxPerSecond;
    if (secs > longest) longest = secs;
  }
  return longest;
}

interface CanvasLike {
  width: number;
  height: number;
  getBoundingClientRect(): { width: number; height: number };
  getContext(contextId: '2d'): DawWaveformCanvasLike | null;
}

const MIN_CANVAS_DIMENSION = 0;

function isCanvasLike(value: unknown): value is CanvasLike {
  if (typeof value !== 'object' || value === null) return false;
  const canvas = value as Partial<CanvasLike>;
  return typeof canvas.getBoundingClientRect === 'function' && typeof canvas.getContext === 'function';
}

// Aggregates each clip's cached peaks at clip.pxPerSecond — the scale the clip was sized
// at — never a module constant, so the painted columns can never disagree with the width
// the same resolved scale produced.
export function paintSessionTabWaveformClips(root: ParentNode, clips: SessionTabWaveformClip[]): void {
  for (const clip of clips) {
    const canvas = root.querySelector(`[data-session-track-index="${clip.trackIndex}"]`);
    if (!isCanvasLike(canvas)) continue;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(MIN_CANVAS_DIMENSION, Math.floor(bounds.width));
    canvas.height = Math.max(MIN_CANVAS_DIMENSION, Math.floor(bounds.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const columns = waveformColumns(clip.pairs, clip.bucketsPerSecond, clip.pxPerSecond, canvas.width);
    drawDawWaveformLane(ctx, columns, canvas.width, canvas.height, WAVEFORM_COLORS.stopped);
  }
}
