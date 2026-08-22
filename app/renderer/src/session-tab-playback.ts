// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { SessionManifest } from './soundcheck-panel';

export interface SessionTabPlaybackView {
  available: boolean;
  playing: boolean;
}

/** Derives the compact Session-toolbar transport from the loaded take and the
 * discrete playback state. Progress deliberately stays out of this view: the
 * DAW runtime paints it imperatively at animation rate. */
export function sessionTabPlaybackView(manifest: SessionManifest | null, playing: boolean): SessionTabPlaybackView {
  return { available: manifest !== null, playing: manifest !== null && playing };
}

/** Raw toolbar markup consumed by LiveCapturePanel's delegated click handler. */
export function sessionTabPlaybackHTML(view: SessionTabPlaybackView): string {
  if (view.playing) {
    return `<button type="button" class="daw-session-playback-btn" id="daw-session-stop" aria-label="Stop recorded session playback">Stop</button>`;
  }
  return `<button type="button" class="daw-session-playback-btn" id="daw-session-play" aria-label="Play recorded session"${view.available ? '' : ' disabled'}>Play</button>`;
}
