// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { sessionTabPlaybackHTML, sessionTabPlaybackView } from './session-tab-playback';

const MANIFEST = { name: 'Sunday service', tracks: [{ kind: 'mono' as const }] };

describe('sessionTabPlaybackView', () => {
  it('disables Play when no recorded session is loaded', () => {
    expect(sessionTabPlaybackView(null, false)).toEqual({ available: false, playing: false });
  });

  it('renders an enabled, accessible Session Play control when stopped with a loaded session', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, false));

    expect(html).toContain('id="daw-session-play"');
    expect(html).toContain('class="daw-session-playback-btn"');
    expect(html).toContain('aria-label="Play recorded session"');
    expect(html).toContain('>Play</button>');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('daw-session-stop');
  });

  it('renders only an accessible Session Stop control while playback is active', () => {
    const html = sessionTabPlaybackHTML(sessionTabPlaybackView(MANIFEST, true));

    expect(html).toContain('id="daw-session-stop"');
    expect(html).toContain('aria-label="Stop recorded session playback"');
    expect(html).toContain('>Stop</button>');
    expect(html).not.toContain('daw-session-play"');
  });
});
