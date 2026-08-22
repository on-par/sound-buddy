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
import { DAW_TIMELINE_PX_PER_SECOND, WAVEFORM_COLORS, dawTimelineX, drawDawWaveformLane, type DawWaveformCanvasLike } from './daw-shell-runtime';

export type SessionPeakStatus = SoundcheckState['peaksStatus'];

export interface SessionTabWaveformClip {
  trackIndex: number;
  stripIndex: number;
  leftPx: number;
  widthPx: number;
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

function isPeakTrack(value: unknown): value is { index: number; kind: 'mono' | 'stereo'; data: string } {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as { index?: unknown; kind?: unknown; data?: unknown };
  return Number.isInteger(track.index)
    && (track.kind === 'mono' || track.kind === 'stereo')
    && typeof track.data === 'string';
}

function peakTracksByIndex(
  tracks: unknown[],
  manifestTrackCount: number,
): Map<number, { index: number; kind: 'mono' | 'stereo'; data: string }> | null {
  const byIndex = new Map<number, { index: number; kind: 'mono' | 'stereo'; data: string }>();
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
): SessionTabWaveformView {
  const generating = manifest !== null && peaksStatus === 'generating';
  if (!manifest || !Array.isArray(manifest.tracks) || !peaks || !Array.isArray(peaks.tracks) || !Number.isFinite(peaks.bucketsPerSecond) || peaks.bucketsPerSecond <= 0) {
    return { generating, clips: [] };
  }
  const peakTracks = peakTracksByIndex(peaks.tracks, manifest.tracks.length);
  if (!peakTracks) return { generating, clips: [] };

  const clips: SessionTabWaveformClip[] = [];
  for (let trackIndex = 0; trackIndex < manifest.tracks.length; trackIndex++) {
    const manifestTrack = manifest.tracks[trackIndex];
    const peakTrack = peakTracks.get(trackIndex);
    if (!isManifestTrack(manifestTrack) || !peakTrack || peakTrack.kind !== manifestTrack.kind) continue;
    const pairs = decodePeaksPairs(peakTrack.data);
    if (!pairs) continue;
    const matches = channelConfig
      .map((strip, stripIndex) => ({ strip, stripIndex }))
      .filter(({ strip }) => strip.kind === manifestTrack.kind && sameChannels(manifestTrack.sourceChannels, stripSourceChannels(strip)));
    if (matches.length !== 1) continue;
    clips.push({
      trackIndex,
      stripIndex: matches[0].stripIndex,
      leftPx: dawTimelineX(0),
      widthPx: (pairs.length / peaks.bucketsPerSecond) * DAW_TIMELINE_PX_PER_SECOND,
      pairs,
      bucketsPerSecond: peaks.bucketsPerSecond,
    });
  }
  return { generating, clips };
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

export function paintSessionTabWaveformClips(root: ParentNode, clips: SessionTabWaveformClip[]): void {
  for (const clip of clips) {
    const canvas = root.querySelector(`[data-session-track-index="${clip.trackIndex}"]`);
    if (!isCanvasLike(canvas)) continue;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(MIN_CANVAS_DIMENSION, Math.floor(bounds.width));
    canvas.height = Math.max(MIN_CANVAS_DIMENSION, Math.floor(bounds.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const columns = waveformColumns(clip.pairs, clip.bucketsPerSecond, DAW_TIMELINE_PX_PER_SECOND, canvas.width);
    drawDawWaveformLane(ctx, columns, canvas.width, canvas.height, WAVEFORM_COLORS.stopped);
  }
}
