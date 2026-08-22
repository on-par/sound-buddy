// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import type { StripConfig } from './live-capture-panel';
import {
  applyRoutingDrawerChange,
  applyRoutingDrawerMasterMixdownChange,
  routeStateForSession,
  routingDrawerHTML,
  type RoutingDrawerChangeDeps,
} from './routingDrawer';
import type { RouteState } from './stores/routeStore';

const SAVED_BUSES = [{ id: 'bus-1', name: 'Lead <Vox>', pattern: 'lead & vox', outputChannel: 3 }];

const TRACKS: StripConfig[] = [
  { kind: 'mono', a: 0, b: 0, label: 'Lead Vocal' },
  { kind: 'stereo', a: 2, b: 3, label: 'Keys' },
];

function routeState(overrides: Partial<RouteState> = {}): RouteState {
  return {
    tracks: [
      { inputChannels: [1], outputChannels: [2] },
      { inputChannels: [2, 3], outputChannels: [4, 5] },
    ],
    savedBuses: [],
    masterMixdown: false,
    ...overrides,
  };
}

function deps(next: RouteState | null = routeState()): RoutingDrawerChangeDeps {
  return {
    routes: {
      updateTrackInput: vi.fn(() => next),
      updateTrackOutput: vi.fn(() => next),
      setMasterMixdown: vi.fn(() => next),
    },
    soundcheck: { setRoute: vi.fn(), setMaster: vi.fn() },
  };
}

describe('routeStateForSession', () => {
  it('seeds cloned mono and stereo inputs plus existing output routes', () => {
    const outputRoutes = [[4], [5, 6]];

    const seeded = routeStateForSession(TRACKS, outputRoutes, SAVED_BUSES);

    expect(seeded).toEqual({
      tracks: [
        { inputChannels: [0], outputChannels: [4] },
        { inputChannels: [2, 3], outputChannels: [5, 6] },
      ],
      savedBuses: SAVED_BUSES,
      masterMixdown: false,
    });
    expect(seeded.tracks[0].outputChannels).not.toBe(outputRoutes[0]);
    expect(seeded.savedBuses).not.toBe(SAVED_BUSES);
    expect(seeded.savedBuses[0]).not.toBe(SAVED_BUSES[0]);
    expect(outputRoutes).toEqual([[4], [5, 6]]);
  });

  it('uses an empty output route when playback has none for a track', () => {
    expect(routeStateForSession(TRACKS, [[4]], [])).toMatchObject({
      tracks: [{ outputChannels: [4] }, { outputChannels: [] }],
    });
  });
});

describe('routingDrawerHTML', () => {
  it('renders selected source assignments and exact selected output cells', () => {
    const html = routingDrawerHTML(TRACKS, routeState(), 6, 6);

    expect(html).toContain('class="daw-routing-source" data-routing-kind="input" data-routing-track-index="0"');
    expect(html).toContain('<option value="1" selected>Ch 2</option>');
    expect(html).toContain('<option value="2,3" selected>Ch 3-4</option>');
    expect(html).toContain('data-routing-kind="output" data-routing-track-index="0" data-routing-channels="2" aria-label="Lead Vocal output Ch 3" aria-pressed="true"');
    expect(html).toContain('data-routing-kind="output" data-routing-track-index="1" data-routing-channels="4,5" aria-label="Keys output Ch 5-6" aria-pressed="true"');
  });

  it('bounds source options and output matrix choices to known device capacity', () => {
    const html = routingDrawerHTML(TRACKS, routeState(), 3, 1);

    expect(html).toContain('<option value="0">Ch 1</option>');
    expect(html).not.toContain('value="3"');
    expect(html).not.toContain('value="2,3"');
    expect(html).toContain('data-routing-channels="0"');
    expect(html).not.toContain('data-routing-track-index="1" data-routing-channels=');
  });

  it('offers no stereo source option when the input device has fewer than two channels', () => {
    const html = routingDrawerHTML(TRACKS, routeState(), 1, 1);

    expect(html).toContain('<option value="0">Ch 1</option>');
    expect(html).not.toContain('value="0,1"');
    expect(html).not.toContain('data-routing-track-index="1" data-routing-channels=');
  });

  it('leaves malformed saved outputs unselected', () => {
    const html = routingDrawerHTML(TRACKS, routeState({
      tracks: [
        { inputChannels: [1], outputChannels: [99] },
        { inputChannels: [2, 3], outputChannels: [1, 3] },
      ],
    }), 6, 6);

    expect(html).not.toContain('aria-pressed="true"');
  });

  it('renders read-only escaped saved-bus assignments and an enabled master mixdown control', () => {
    const html = routingDrawerHTML(TRACKS, routeState({ savedBuses: SAVED_BUSES, masterMixdown: true }), 6, 6);

    expect(html).toContain('Lead &lt;Vox&gt;');
    expect(html).toContain('lead &amp; vox');
    expect(html).toContain('Ch 4');
    expect(html).toContain('class="daw-routing-master-mixdown"');
    expect(html).toContain('aria-label="Force stereo master mixdown" checked');
    expect(html).not.toContain('data-routing-bus');
  });

  it('renders an empty saved-bus assignment section and unchecked master control', () => {
    const html = routingDrawerHTML(TRACKS, routeState(), 6, 6);

    expect(html).toContain('No saved bus assignments for this session.');
    expect(html).toContain('class="daw-routing-master-mixdown"');
    expect(html).not.toContain('aria-label="Force stereo master mixdown" checked');
  });
});

describe('applyRoutingDrawerChange', () => {
  it('updates only the shared input assignment', () => {
    const changeDeps = deps();

    const next = applyRoutingDrawerChange('input', 'session-a', 1, [3, 4], changeDeps);

    expect(next).toEqual(routeState());
    expect(changeDeps.routes.updateTrackInput).toHaveBeenCalledWith('session-a', 1, [3, 4]);
    expect(changeDeps.routes.updateTrackOutput).not.toHaveBeenCalled();
    expect(changeDeps.soundcheck.setRoute).not.toHaveBeenCalled();
  });

  it('updates output before delegating its base channel to playback', () => {
    const calls: string[] = [];
    const next = routeState();
    const changeDeps: RoutingDrawerChangeDeps = {
      routes: {
        updateTrackInput: vi.fn(),
        updateTrackOutput: vi.fn(() => { calls.push('route'); return next; }),
        setMasterMixdown: vi.fn(),
      },
      soundcheck: { setRoute: vi.fn(() => calls.push('playback')), setMaster: vi.fn() },
    };

    expect(applyRoutingDrawerChange('output', 'session-a', 0, [5], changeDeps)).toBe(next);
    expect(changeDeps.routes.updateTrackOutput).toHaveBeenCalledWith('session-a', 0, [5]);
    expect(changeDeps.soundcheck.setRoute).toHaveBeenCalledWith(0, 5);
    expect(calls).toEqual(['route', 'playback']);
  });

  it('does not notify playback when the shared output update has no target', () => {
    const changeDeps = deps(null);

    expect(applyRoutingDrawerChange('output', 'missing', 0, [5], changeDeps)).toBeNull();
    expect(changeDeps.soundcheck.setRoute).not.toHaveBeenCalled();
  });

  it('rejects malformed data-derived identities and channels', () => {
    const changeDeps = deps();

    expect(applyRoutingDrawerChange('input', '', 0, [1], changeDeps)).toBeNull();
    expect(applyRoutingDrawerChange('output', 'session-a', 0.5, [1], changeDeps)).toBeNull();
    expect(applyRoutingDrawerChange('output', 'session-a', 0, [Number.NaN], changeDeps)).toBeNull();
    expect(changeDeps.routes.updateTrackInput).not.toHaveBeenCalled();
    expect(changeDeps.routes.updateTrackOutput).not.toHaveBeenCalled();
    expect(changeDeps.soundcheck.setRoute).not.toHaveBeenCalled();
  });
});

describe('applyRoutingDrawerMasterMixdownChange', () => {
  it('updates session state before synchronizing the playback master', () => {
    const calls: string[] = [];
    const next = routeState({ masterMixdown: true });
    const changeDeps: RoutingDrawerChangeDeps = {
      routes: {
        updateTrackInput: vi.fn(),
        updateTrackOutput: vi.fn(),
        setMasterMixdown: vi.fn(() => { calls.push('route'); return next; }),
      },
      soundcheck: { setRoute: vi.fn(), setMaster: vi.fn(() => calls.push('playback')) },
    };

    expect(applyRoutingDrawerMasterMixdownChange('session-a', true, changeDeps)).toBe(next);
    expect(changeDeps.routes.setMasterMixdown).toHaveBeenCalledWith('session-a', true);
    expect(changeDeps.soundcheck.setMaster).toHaveBeenCalledWith(true);
    expect(calls).toEqual(['route', 'playback']);
  });

  it('does not update playback for a missing or empty session', () => {
    const changeDeps = deps(null);

    expect(applyRoutingDrawerMasterMixdownChange('missing', true, changeDeps)).toBeNull();
    expect(applyRoutingDrawerMasterMixdownChange('', true, changeDeps)).toBeNull();
    expect(changeDeps.soundcheck.setMaster).not.toHaveBeenCalled();
  });
});
