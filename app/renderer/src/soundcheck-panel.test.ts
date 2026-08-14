// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  outputDeviceListView,
  soundcheckTrackListView,
  mixdownNoticeText,
  playGuardOk,
  sameTrackShape,
  busPatternMatches,
  applyBusRoutes,
  type SessionManifest,
  type SessionManifestTrack,
} from './soundcheck-panel';
import type { SoundcheckBus } from '../../electron/ipc/api';

// The pure playback-routing.js classic-script this module reads off
// `window.playbackRouting` — real module, same convention as
// liveCaptureStore.test.ts's armState/groupState requires.
const playbackRouting = require('../playback-routing.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { playbackRouting };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('outputDeviceListView', () => {
  it('returns [] when the result has no devices field', () => {
    expect(outputDeviceListView(null)).toEqual({ devices: [] });
    expect(outputDeviceListView({})).toEqual({ devices: [] });
  });

  it('passes real devices through', () => {
    const devices = [{ index: 0, name: 'Focusrite', channels: 8 }];
    expect(outputDeviceListView({ devices })).toEqual({ devices });
  });
});

describe('soundcheckTrackListView', () => {
  it('returns [] when there is no manifest', () => {
    expect(soundcheckTrackListView(null, [], 0)).toEqual([]);
  });

  it('returns [] when the manifest has no tracks', () => {
    expect(soundcheckTrackListView({ tracks: [] }, [], 0)).toEqual([]);
  });

  it('falls back to "Track N" when a track has no label', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    const rows = soundcheckTrackListView(manifest, [[0]], 2);
    expect(rows[0].label).toBe('Track 1');
  });

  it('uses the track label when present', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono', label: 'Vocal' }] };
    const rows = soundcheckTrackListView(manifest, [[0]], 2);
    expect(rows[0].label).toBe('Vocal');
  });

  it('builds mono channel options up to max(deviceChannels, 1)', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    const rows = soundcheckTrackListView(manifest, [[1]], 4);
    expect(rows[0].stereo).toBe(false);
    expect(rows[0].routeBase).toBe(1);
    expect(rows[0].options).toEqual([
      { value: 0, label: 'Ch 1', selected: false },
      { value: 1, label: 'Ch 2', selected: true },
      { value: 2, label: 'Ch 3', selected: false },
      { value: 3, label: 'Ch 4', selected: false },
    ]);
  });

  it('builds stereo channel options as adjacent pairs up to max(deviceChannels, 2)', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'stereo' }] };
    const rows = soundcheckTrackListView(manifest, [[0, 1]], 4);
    expect(rows[0].stereo).toBe(true);
    expect(rows[0].options).toEqual([
      { value: 0, label: 'Ch 1-2', selected: true },
      { value: 1, label: 'Ch 2-3', selected: false },
      { value: 2, label: 'Ch 3-4', selected: false },
    ]);
  });

  it('defaults deviceChannels to 2 minimum when unknown (0 = default output)', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'stereo' }] };
    const rows = soundcheckTrackListView(manifest, [[0, 1]], 0);
    expect(rows[0].options).toEqual([{ value: 0, label: 'Ch 1-2', selected: true }]);
  });

  it('defaults a missing route to channel 0', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    const rows = soundcheckTrackListView(manifest, [], 2);
    expect(rows[0].routeBase).toBe(0);
  });

  it('never carries a disabled field (routing stays editable while playing)', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }, { kind: 'stereo' }] };
    const rows = soundcheckTrackListView(manifest, [[0], [1, 2]], 4);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty('disabled');
    expect(rows[1]).not.toHaveProperty('disabled');
  });
});

describe('mixdownNoticeText', () => {
  it('returns null when there is no manifest', () => {
    expect(mixdownNoticeText(null, [], 0, false)).toBeNull();
  });

  it('returns null when the device is big enough and master is off', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    expect(mixdownNoticeText(manifest, [[0]], 2, false)).toBeNull();
  });

  it('returns the master text when the master toggle is on', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
    expect(mixdownNoticeText(manifest, [[0]], 2, true)).toBe('Playing a stereo master mixdown.');
  });

  it('returns the too-small text when a concrete device cannot fit the routing', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'stereo' }] };
    expect(mixdownNoticeText(manifest, [[0, 1]], 1, false))
      .toBe('The selected output has 1 channels but the routing needs 2 — playback folds to a stereo master mixdown.');
  });

  it('does not pre-warn for the unknown-channel-count default device', () => {
    const manifest: SessionManifest = { tracks: [{ kind: 'stereo' }] };
    expect(mixdownNoticeText(manifest, [[0, 1]], 0, false)).toBeNull();
  });
});

describe('playGuardOk', () => {
  const manifest: SessionManifest = { tracks: [{ kind: 'mono' }] };

  it('is true only once a manifest is loaded, devices are loaded, and nothing is playing', () => {
    expect(playGuardOk(manifest, true, false)).toBe(true);
  });

  it('is false with no manifest', () => {
    expect(playGuardOk(null, true, false)).toBe(false);
  });

  it('is false while devices have not loaded', () => {
    expect(playGuardOk(manifest, false, false)).toBe(false);
  });

  it('is false while playing', () => {
    expect(playGuardOk(manifest, true, true)).toBe(false);
  });
});

describe('sameTrackShape', () => {
  it('is true when both manifests have the same track count and kinds', () => {
    const a: SessionManifest = { tracks: [{ kind: 'mono' }, { kind: 'stereo' }] };
    const b: SessionManifest = { tracks: [{ kind: 'mono', label: 'Vocal' }, { kind: 'stereo' }] };
    expect(sameTrackShape(a, b)).toBe(true);
  });

  it('is false when the track counts differ', () => {
    const a: SessionManifest = { tracks: [{ kind: 'mono' }, { kind: 'stereo' }] };
    const b: SessionManifest = { tracks: [{ kind: 'mono' }] };
    expect(sameTrackShape(a, b)).toBe(false);
  });

  it('is false when a kind differs at the same index', () => {
    const a: SessionManifest = { tracks: [{ kind: 'mono' }, { kind: 'stereo' }] };
    const b: SessionManifest = { tracks: [{ kind: 'mono' }, { kind: 'mono' }] };
    expect(sameTrackShape(a, b)).toBe(false);
  });

  it('is false when either manifest is null', () => {
    const a: SessionManifest = { tracks: [{ kind: 'mono' }] };
    expect(sameTrackShape(null, a)).toBe(false);
    expect(sameTrackShape(a, null)).toBe(false);
    expect(sameTrackShape(null, null)).toBe(false);
  });
});

describe('busPatternMatches', () => {
  it('matches an exact label case-insensitively', () => {
    expect(busPatternMatches('AG', 'ag')).toBe(true);
    expect(busPatternMatches('ag', 'AG')).toBe(true);
  });

  it('matches a case-insensitive substring', () => {
    expect(busPatternMatches('AG Left', 'ag')).toBe(true);
    expect(busPatternMatches('acoustic-guitar', 'guitar')).toBe(true);
  });

  it('does not match when the pattern is absent from the label', () => {
    expect(busPatternMatches('Vocal', 'ag')).toBe(false);
  });

  it('never matches an empty label', () => {
    expect(busPatternMatches('', 'ag')).toBe(false);
    expect(busPatternMatches('   ', 'ag')).toBe(false);
  });

  it('never matches an empty pattern', () => {
    expect(busPatternMatches('AG', '')).toBe(false);
    expect(busPatternMatches('AG', '   ')).toBe(false);
  });
});

describe('applyBusRoutes', () => {
  const buses: SoundcheckBus[] = [{ id: 'b1', name: 'Acoustic Guitar', pattern: 'ag', outputChannel: 3 }];

  it('routes a matched mono track to the bus output channel', () => {
    const tracks: SessionManifestTrack[] = [{ kind: 'mono', label: 'AG' }];
    expect(applyBusRoutes(tracks, [[0]], buses)).toEqual([[3]]);
  });

  it('routes a matched stereo track to the adjacent pair [c, c+1]', () => {
    const tracks: SessionManifestTrack[] = [{ kind: 'stereo', label: 'AG' }];
    expect(applyBusRoutes(tracks, [[0, 1]], buses)).toEqual([[3, 4]]);
  });

  it('leaves an unmatched track on its base route', () => {
    const tracks: SessionManifestTrack[] = [{ kind: 'mono', label: 'Vocal' }];
    expect(applyBusRoutes(tracks, [[2]], buses)).toEqual([[2]]);
  });

  it('first matching bus in definition order wins when several match', () => {
    const tracks: SessionManifestTrack[] = [{ kind: 'mono', label: 'AG' }];
    const twoBuses: SoundcheckBus[] = [
      { id: 'b1', name: 'Acoustic Guitar', pattern: 'ag', outputChannel: 3 },
      { id: 'b2', name: 'Broad', pattern: 'a', outputChannel: 7 },
    ];
    expect(applyBusRoutes(tracks, [[0]], twoBuses)).toEqual([[3]]);
  });

  it('leaves every base route untouched when there are no buses', () => {
    const tracks: SessionManifestTrack[] = [{ kind: 'mono', label: 'AG' }, { kind: 'mono', label: 'Vocal' }];
    expect(applyBusRoutes(tracks, [[5], [6]], [])).toEqual([[5], [6]]);
  });

  it('matches on the stem basename when the label is blank', () => {
    const tracks: SessionManifestTrack[] = [{ kind: 'mono', file: '/tmp/session/ag-left.wav' }];
    expect(applyBusRoutes(tracks, [[0]], buses)).toEqual([[3]]);
  });

  it('returns exactly one route per track', () => {
    const tracks: SessionManifestTrack[] = [
      { kind: 'mono', label: 'AG' },
      { kind: 'stereo', label: 'OH' },
      { kind: 'mono' },
    ];
    expect(applyBusRoutes(tracks, [[0], [1, 2], [4]], buses)).toEqual([[3], [1, 2], [4]]);
  });
});
