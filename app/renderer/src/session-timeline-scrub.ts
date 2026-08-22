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
  windowTarget: SessionTimelineScrubWindow;
  pointerId: number;
  clientX: number;
  getDurationSecs(): number | undefined;
  isPlaying(): boolean;
  previewLeftPx(leftPx: number): void;
  seekTo(elapsedSecs: number): void | Promise<void>;
}

export function beginSessionTimelineScrub(deps: SessionTimelineScrubDeps): boolean {
  let latestClientX = deps.clientX;

  const previewAt = (clientX: number) => {
    const durationSecs = deps.getDurationSecs();
    if (durationSecs === undefined) return null;
    const preview = soundcheckTimelinePreviewFromPointer(
      clientX,
      deps.surface.getBoundingClientRect().left,
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
    if (!deps.isPlaying()) return;
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
