// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { SessionManifest } from './soundcheck-panel';

export interface SessionTabPlaybackView {
  available: boolean;
  playing: boolean;
  looping: boolean;
}

/** Derives the compact Session-toolbar transport from the loaded take and the
 * discrete playback state. Progress deliberately stays out of this view: the
 * DAW runtime paints it imperatively at animation rate. */
export function sessionTabPlaybackView(manifest: SessionManifest | null, playing: boolean, looping: boolean): SessionTabPlaybackView {
  const available = manifest !== null;
  return { available, playing: available && playing, looping: available && looping };
}

/** Raw toolbar markup consumed by LiveCapturePanel's delegated click handler.
 *  #1347: the five transport buttons are wrapped in one role="group" so the
 *  packed Session toolbar reads as a single "Session playback" cluster rather
 *  than five loose buttons, and the two longest/most-ambiguous labels shrink to
 *  `Loop sel`/`To start` — their descriptive aria-labels are unchanged, so the
 *  accessible name every command exposes is exactly what it was. Click
 *  delegation keys off the ids, so the wrapper changes no behaviour. */
export function sessionTabPlaybackHTML(view: SessionTabPlaybackView): string {
  const playDisabled = !view.available || view.playing;
  const stopDisabled = !view.available || !view.playing;
  const unavailable = view.available ? '' : ' disabled';
  return `<span class="daw-transport-playback daw-transport-group" role="group" aria-label="Session playback">`
    + `<button type="button" class="daw-session-playback-btn" id="daw-session-play" aria-label="Play recorded session"${playDisabled ? ' disabled' : ''}>Play</button>`
    + `<button type="button" class="daw-session-playback-btn" id="daw-session-stop" aria-label="Stop recorded session playback"${stopDisabled ? ' disabled' : ''}>Stop</button>`
    + `<button type="button" class="daw-session-playback-btn${view.looping ? ' active' : ''}" id="daw-session-loop" aria-label="Loop recorded session playback" aria-pressed="${view.looping}"${unavailable}>Loop</button>`
    + `<button type="button" class="daw-session-playback-btn" id="daw-session-loop-selection" aria-label="Set the loop range to the time selection"${unavailable}>Loop sel</button>`
    + `<button type="button" class="daw-session-playback-btn" id="daw-session-return" aria-label="Return recorded session playback to start"${unavailable}>To start</button>`
    + `</span>`;
}
