// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { sessionTabPlaybackHTML, sessionTabPlaybackView } from './session-tab-playback';

const MANIFEST = { name: 'Sunday service', tracks: [{ kind: 'mono' as const }] };

describe('sessionTabPlaybackView', () => {
  it('renders all disabled controls when no recorded session is loaded', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(null, false, false));

    expect(sessionTabPlaybackView(null, false, false)).toEqual({ available: false, playing: false, looping: false });
    for (const id of ['play', 'stop', 'loop', 'return']) expect(html).toContain(`id="daw-session-${id}"`);
    expect((html.match(/ disabled/g) ?? [])).toHaveLength(4);
  });

  it('renders Play, Stop, Loop, and Return with stopped-state availability', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false, false));

    expect(html).toContain('id="daw-session-play"');
    expect(html).toContain('class="daw-session-playback-btn"');
    expect(html).toContain('aria-label="Play recorded session"');
    expect(html).toContain('id="daw-session-stop"');
    expect(html).toContain('aria-label="Stop recorded session playback" disabled');
    expect(html).toContain('id="daw-session-loop"');
    expect(html).toContain('aria-label="Loop recorded session playback" aria-pressed="false"');
    expect(html).toContain('id="daw-session-return"');
    expect(html).toContain('aria-label="Return recorded session playback to start"');
  });

  it('disables Play and enables Stop while playback is active', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, true, false));

    expect(html).toContain('id="daw-session-play" aria-label="Play recorded session" disabled');
    expect(html).toContain('id="daw-session-stop" aria-label="Stop recorded session playback">');
  });

  it('marks Loop pressed and active when looping', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false, true));

    expect(html).toContain('daw-session-playback-btn active');
    expect(html).toContain('aria-pressed="true"');
  });
});
