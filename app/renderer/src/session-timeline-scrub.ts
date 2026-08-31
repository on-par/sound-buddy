// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { soundcheckTimelinePreviewFromPointer } from './soundcheck-playhead';

export interface SessionTimelineScrubSurface {
  getBoundingClientRect(): { left: number };
}

export interface SessionTimelineScrubRoot {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  addEventListener(type: 'lostpointercapture', listener: () => void): void;
  removeEventListener(type: 'lostpointercapture', listener: () => void): void;
}

export interface SessionTimelineScrubWindow {
  addEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointercancel', listener: () => void): void;
  removeEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointercancel', listener: () => void): void;
}

export interface SessionTimelineScrubDeps {
  root: SessionTimelineScrubRoot;
  surface: SessionTimelineScrubSurface;
  /** The visible range's horizontal scroll offset in pixels (timelineScrollOffsetPx).
   *  app.css's shared re-basing translate shifts every painted surface left by this,
   *  but the pressed .daw-ruler / .daw-lane element's own box does not move — so the
   *  painted t=0 client x is the surface's left edge MINUS this offset. Required, not
   *  optional: a scroll-unaware scrub call site is the #1326 defect, and requiring the
   *  field makes a future one fail to compile. */
  scrollOffsetPx: number;
  windowTarget: SessionTimelineScrubWindow;
  pointerId: number;
  clientX: number;
  getDurationSecs(): number | undefined;
  /** Asked on pointer release, not the transport flag — the scrub zone's
   *  policy (session-ruler-scrub.ts) decides whether a stopped ruler scrub
   *  may commit (#1285). */
  canCommitSeek(): boolean;
  previewLeftPx(leftPx: number): void;
  seekTo(elapsedSecs: number): void | Promise<void>;
}

/** The painted t=0 client x for a scrub surface: its own left edge re-based by the
 *  visible range's scroll offset. A non-finite offset is treated as 0 rather than
 *  propagating NaN into a seek target — the same guard laneBackgroundInsertMarkerSecs
 *  applies to its own scrollOffsetPx. */
export function scrubTimelineLeftPx(surfaceLeftPx: number, scrollOffsetPx: number): number {
  return surfaceLeftPx - (Number.isFinite(scrollOffsetPx) ? scrollOffsetPx : 0);
}

export function beginSessionTimelineScrub(deps: SessionTimelineScrubDeps): boolean {
  let latestClientX = deps.clientX;

  const previewAt = (clientX: number) => {
    const durationSecs = deps.getDurationSecs();
    if (durationSecs === undefined) return null;
    const preview = soundcheckTimelinePreviewFromPointer(
      clientX,
      scrubTimelineLeftPx(deps.surface.getBoundingClientRect().left, deps.scrollOffsetPx),
      durationSecs,
    );
    if (preview) deps.previewLeftPx(preview.leftPx);
    return preview;
  };
  if (!previewAt(latestClientX)) return false;

  const cleanup = (): void => {
    deps.windowTarget.removeEventListener('pointermove', onPointerMove);
    deps.windowTarget.removeEventListener('pointerup', onPointerUp);
    deps.windowTarget.removeEventListener('pointercancel', cleanup);
    deps.root.removeEventListener('lostpointercapture', cleanup);
    if (deps.root.hasPointerCapture(deps.pointerId)) deps.root.releasePointerCapture(deps.pointerId);
  };
  const onPointerMove = (move: PointerEvent): void => {
    if (move.pointerId !== deps.pointerId) return;
    latestClientX = move.clientX;
    previewAt(latestClientX);
  };
  const onPointerUp = (up: PointerEvent): void => {
    if (up.pointerId !== deps.pointerId) return;
    cleanup();
    if (!deps.canCommitSeek()) return;
    latestClientX = up.clientX;
    const preview = previewAt(latestClientX);
    if (preview) void deps.seekTo(preview.elapsedSecs);
  };

  deps.root.setPointerCapture(deps.pointerId);
  deps.windowTarget.addEventListener('pointermove', onPointerMove);
  deps.windowTarget.addEventListener('pointerup', onPointerUp);
  deps.windowTarget.addEventListener('pointercancel', cleanup);
  deps.root.addEventListener('lostpointercapture', cleanup);
  return true;
}
