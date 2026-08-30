// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Session scrub ZONE policy (#1285): which surface was hit, whether a scrub
// may begin/commit there, and which duration the pointer-to-time clamp uses.
// session-timeline-scrub.ts stays the gesture lifecycle (preview on move,
// commit on release) — this module owns none of that, only the policy it
// asks. Must not import ./timeline-bpm (ADR-0107) — BPM is display-only and
// never participates in a scrub's coordinate or duration.

import type { SessionManifest } from './soundcheck-panel';

export const RULER_SCRUB_ZONE_CLASS = 'daw-ruler';
export const LANE_SCRUB_ZONE_CLASS = 'daw-lane';
/** The one selector LiveCapturePanel's pointerdown closest() call uses. */
export const SESSION_SCRUB_SURFACE_SELECTOR = `.${RULER_SCRUB_ZONE_CLASS}, .${LANE_SCRUB_ZONE_CLASS}`;

export type SessionScrubSurface = 'ruler' | 'lane';

export interface SessionScrubGate {
  /** soundcheckStore.playing */
  playing: boolean;
  /** a session manifest is loaded */
  hasSession: boolean;
  /** a live capture is running in record mode */
  recording: boolean;
}

export interface SessionScrubDurationSources {
  /** The backend progress tick's duration (authoritative while playing). */
  tickDurationSecs?: number;
  /** The longest painted take clip, from sessionTakeDurationSecs. */
  takeDurationSecs?: number;
  /** session.json frames / sampleRate. */
  manifestDurationSecs?: number;
}

export function sessionScrubSurfaceKind(surface: { classList: { contains(token: string): boolean } }): SessionScrubSurface {
  return surface.classList.contains(RULER_SCRUB_ZONE_CLASS) ? 'ruler' : 'lane';
}

export function canBeginSessionScrub(surface: SessionScrubSurface, gate: SessionScrubGate): boolean {
  if (gate.recording) return false;
  if (surface === 'ruler') return gate.hasSession;
  return gate.playing;
}

function positiveSecs(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export function sessionScrubDurationSecs(sources: SessionScrubDurationSources): number | undefined {
  const candidates = [sources.tickDurationSecs, sources.takeDurationSecs, sources.manifestDurationSecs];
  for (const candidate of candidates) {
    if (positiveSecs(candidate)) return candidate;
  }
  return undefined;
}

export function sessionManifestDurationSecs(manifest: SessionManifest | null): number | undefined {
  if (manifest === null) return undefined;
  if (!positiveSecs(manifest.sampleRate)) return undefined;
  const framesValues = manifest.tracks.map((track) => track.frames).filter(positiveSecs);
  if (framesValues.length === 0) return undefined;
  return Math.max(...framesValues) / manifest.sampleRate;
}
