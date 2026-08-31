// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { sessionTabPlaybackButtons, sessionTabPlaybackHTML, sessionTabPlaybackView } from './session-tab-playback';

const MANIFEST = { name: 'Sunday service', tracks: [{ kind: 'mono' as const }] };

const VERBATIM_LABELS = [
  'Play recorded session',
  'Stop recorded session playback',
  'Loop recorded session playback',
  'Set the loop range to the time selection',
  'Return recorded session playback to start',
];

describe('sessionTabPlaybackView', () => {
  it('renders all disabled controls when no recorded session is loaded', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(null, false, false));

    expect(sessionTabPlaybackView(null, false, false)).toEqual({ available: false, playing: false, looping: false });
    for (const id of ['play', 'stop', 'loop', 'loop-selection', 'return']) expect(html).toContain(`id="daw-session-${id}"`);
    expect((html.match(/ disabled/g) ?? [])).toHaveLength(5);
  });

  it('renders Play, Stop, Loop, Loop Selection, and Return with stopped-state availability', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false, false));

    expect(html).toContain('id="daw-session-play" aria-label="Play recorded session" title="Play recorded session"');
    expect(html).toContain('class="daw-session-playback-btn daw-session-playback-btn--icon"');
    expect(html).toContain('id="daw-session-stop" aria-label="Stop recorded session playback" title="Stop recorded session playback" disabled');
    expect(html).toContain('id="daw-session-loop" aria-label="Loop recorded session playback" title="Loop recorded session playback" aria-pressed="false"');
    expect(html).toContain('id="daw-session-loop-selection" aria-label="Set the loop range to the time selection" title="Set the loop range to the time selection"');
    expect(html).toContain('id="daw-session-return" aria-label="Return recorded session playback to start" title="Return recorded session playback to start"');
  });

  it('disables Play and enables Stop while playback is active', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, true, false));

    expect(html).toContain('id="daw-session-play" aria-label="Play recorded session" title="Play recorded session" disabled');
    expect(html).toContain('id="daw-session-stop" aria-label="Stop recorded session playback" title="Stop recorded session playback">');
  });

  it('marks Loop pressed and active when looping', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false, true));

    expect(html).toContain('daw-session-playback-btn daw-session-playback-btn--icon active');
    expect(html).toContain('aria-pressed="true"');
  });

  it('every button title equals its aria-label and its body contains an svg icon', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false, false));
    const matches = [...html.matchAll(/aria-label="([^"]+)" title="([^"]+)"[^>]*>(<svg[^]*?<\/svg>)<\/button>/g)];
    expect(matches).toHaveLength(5);
    for (const [, label, title, svg] of matches) {
      expect(title).toBe(label);
      expect(svg.startsWith('<svg')).toBe(true);
    }
  });

  it('preserves the pre-#1347 accessible-name strings verbatim', () => {
    const buttons = sessionTabPlaybackButtons(sessionTabPlaybackView(MANIFEST, false, false));
    expect(buttons.map((b) => b.label)).toEqual(VERBATIM_LABELS);
  });
});
