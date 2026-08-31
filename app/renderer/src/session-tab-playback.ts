// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { SessionManifest } from './soundcheck-panel';
import { iconSvg } from './report-card';

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

export interface SessionPlaybackButton {
  id: string;
  icon: string;
  /** The accessible name AND the tooltip — one string, used for both. */
  label: string;
  disabled: boolean;
  pressed: boolean | null;
  active: boolean;
}

/** The Session toolbar's five playback commands, in display order. The label
 *  strings are byte-identical to the pre-#1347 aria-labels so the accessible
 *  name never drifts when the visible control becomes icon-only. */
export function sessionTabPlaybackButtons(view: SessionTabPlaybackView): SessionPlaybackButton[] {
  return [
    { id: 'daw-session-play', icon: 'play', label: 'Play recorded session', disabled: !view.available || view.playing, pressed: null, active: false },
    { id: 'daw-session-stop', icon: 'square', label: 'Stop recorded session playback', disabled: !view.available || !view.playing, pressed: null, active: false },
    { id: 'daw-session-loop', icon: 'repeat', label: 'Loop recorded session playback', disabled: !view.available, pressed: view.looping, active: view.looping },
    { id: 'daw-session-loop-selection', icon: 'brackets', label: 'Set the loop range to the time selection', disabled: !view.available, pressed: null, active: false },
    { id: 'daw-session-return', icon: 'skip-back', label: 'Return recorded session playback to start', disabled: !view.available, pressed: null, active: false },
  ];
}

/** Raw toolbar markup consumed by LiveCapturePanel's delegated click handler. */
export function sessionTabPlaybackHTML(view: SessionTabPlaybackView): string {
  return sessionTabPlaybackButtons(view).map((b) =>
    `<button type="button" class="daw-session-playback-btn daw-session-playback-btn--icon${b.active ? ' active' : ''}" `
    + `id="${b.id}" aria-label="${b.label}" title="${b.label}"`
    + (b.pressed === null ? '' : ` aria-pressed="${b.pressed}"`)
    + (b.disabled ? ' disabled' : '')
    + `>${iconSvg(b.icon, 15)}</button>`).join('');
}
