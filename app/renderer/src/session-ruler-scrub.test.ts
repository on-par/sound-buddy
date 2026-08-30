// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import {
  RULER_SCRUB_ZONE_CLASS,
  SESSION_SCRUB_SURFACE_SELECTOR,
  canBeginSessionScrub,
  sessionManifestDurationSecs,
  sessionScrubDurationSecs,
  sessionScrubSurfaceKind,
  type SessionScrubGate,
} from './session-ruler-scrub';

describe('SESSION_SCRUB_SURFACE_SELECTOR', () => {
  it('selects both the ruler and lane scrub zones', () => {
    expect(SESSION_SCRUB_SURFACE_SELECTOR).toBe('.daw-ruler, .daw-lane');
  });
});

describe('sessionScrubSurfaceKind', () => {
  it('returns ruler for an element carrying the ruler scrub zone class', () => {
    expect(sessionScrubSurfaceKind({ classList: { contains: (t) => t === RULER_SCRUB_ZONE_CLASS } })).toBe('ruler');
  });

  it('returns lane for an element without the ruler scrub zone class', () => {
    expect(sessionScrubSurfaceKind({ classList: { contains: () => false } })).toBe('lane');
  });
});

describe('canBeginSessionScrub', () => {
  const gate = (overrides: Partial<SessionScrubGate>): SessionScrubGate => ({
    playing: false,
    hasSession: true,
    recording: false,
    ...overrides,
  });

  it('allows the ruler to scrub a loaded, stopped session (#1285)', () => {
    expect(canBeginSessionScrub('ruler', gate({ playing: false, hasSession: true }))).toBe(true);
  });

  it('allows the ruler to scrub a loaded, playing session', () => {
    expect(canBeginSessionScrub('ruler', gate({ playing: true, hasSession: true }))).toBe(true);
  });

  it('refuses the ruler when no session is loaded', () => {
    expect(canBeginSessionScrub('ruler', gate({ playing: false, hasSession: false }))).toBe(false);
  });

  it('refuses the ruler while a live capture is recording', () => {
    expect(canBeginSessionScrub('ruler', gate({ recording: true }))).toBe(false);
  });

  it('refuses the lane surface while stopped', () => {
    expect(canBeginSessionScrub('lane', gate({ playing: false, hasSession: true }))).toBe(false);
  });

  it('allows the lane surface while playing', () => {
    expect(canBeginSessionScrub('lane', gate({ playing: true, hasSession: true }))).toBe(true);
  });

  it('refuses the lane surface while playing but recording', () => {
    expect(canBeginSessionScrub('lane', gate({ playing: true, hasSession: true, recording: true }))).toBe(false);
  });
});

describe('sessionScrubDurationSecs', () => {
  it('prefers the tick duration over the take and manifest durations', () => {
    expect(sessionScrubDurationSecs({ tickDurationSecs: 10, takeDurationSecs: 5, manifestDurationSecs: 1 })).toBe(10);
  });

  it('falls through an absent tick duration to the take duration', () => {
    expect(sessionScrubDurationSecs({ takeDurationSecs: 5, manifestDurationSecs: 1 })).toBe(5);
  });

  it('falls through a zero tick duration to the take duration', () => {
    expect(sessionScrubDurationSecs({ tickDurationSecs: 0, takeDurationSecs: 5, manifestDurationSecs: 1 })).toBe(5);
  });

  it('falls through to the manifest duration when tick and take are absent', () => {
    expect(sessionScrubDurationSecs({ manifestDurationSecs: 1 })).toBe(1);
  });

  it('rejects a non-finite tick duration and falls through', () => {
    expect(sessionScrubDurationSecs({ tickDurationSecs: Infinity, takeDurationSecs: 5 })).toBe(5);
  });

  it('rejects a NaN take duration and falls through', () => {
    expect(sessionScrubDurationSecs({ takeDurationSecs: NaN, manifestDurationSecs: 1 })).toBe(1);
  });

  it('rejects a negative manifest duration', () => {
    expect(sessionScrubDurationSecs({ manifestDurationSecs: -1 })).toBeUndefined();
  });

  it('returns undefined when all three sources are unusable', () => {
    expect(sessionScrubDurationSecs({})).toBeUndefined();
  });
});

describe('sessionManifestDurationSecs', () => {
  it('returns undefined for a null manifest', () => {
    expect(sessionManifestDurationSecs(null)).toBeUndefined();
  });

  it('returns undefined when sampleRate is missing', () => {
    expect(sessionManifestDurationSecs({ tracks: [{ kind: 'mono', frames: 48000 }] })).toBeUndefined();
  });

  it('returns undefined when sampleRate is non-finite or zero', () => {
    expect(sessionManifestDurationSecs({ tracks: [{ kind: 'mono', frames: 48000 }], sampleRate: 0 })).toBeUndefined();
    expect(sessionManifestDurationSecs({ tracks: [{ kind: 'mono', frames: 48000 }], sampleRate: Infinity })).toBeUndefined();
  });

  it('returns undefined when no track has a finite positive frame count', () => {
    expect(sessionManifestDurationSecs({ tracks: [{ kind: 'mono' }, { kind: 'stereo', frames: 0 }], sampleRate: 48000 })).toBeUndefined();
  });

  it('returns the longest track duration in seconds', () => {
    expect(sessionManifestDurationSecs({
      sampleRate: 48000,
      tracks: [
        { kind: 'mono', frames: 48000 },
        { kind: 'stereo', frames: 96000 },
      ],
    })).toBe(2);
  });
});
