// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createStore } from 'zustand/vanilla';
import {
  createMixerStore,
  bindMixerIngest,
  bindMixerRoom,
  roomCurveOf,
  useMixerStore,
  INITIAL_MIXER_STATE,
  ROOM_SAMPLE_MS,
  type MixerConsoleInput,
  type MixerRoomInput,
} from './mixerStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useConsoleStore } from './consoleStore';
import { CLIP_HOLD_MS } from '../mixer/rules';
import { DISMISS_MUTE_MS } from '../mixer/attention';
import { ROOM_RING_SUSTAIN_MS } from '../mixer/room-ring';
import type { ConsoleChannelStateDto } from '../../../electron/ipc/api';

const ONLINE = { status: 'online' as const, metersDegraded: false };

function channel(index: number, faderDb = -5): ConsoleChannelStateDto {
  return {
    index, name: `Ch${index}`, faderDb, on: true, icon: 1,
    color: { base: 'red', inverted: false },
    dynamics: { on: true, mode: 'COMP', thr: -20, ratio: 4, knee: 1, mgain: 0 },
  };
}

function input(overrides: Partial<MixerConsoleInput> = {}): MixerConsoleInput {
  return {
    liveChannels: [channel(1), channel(2)],
    liveChannelsReadAt: 1000,
    liveMeters: [0.2, 0.2],
    liveDynamicsGainReduction: [0, 0],
    link: ONLINE,
    ...overrides,
  };
}

afterEach(() => {
  useMixerStore.setState({ ...INITIAL_MIXER_STATE });
});

describe('mixerStore ingest', () => {
  it('turns a full-scale meter frame into a clipping issue stamped with its first-seen time', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveMeters: [1.3, 0.2] }), 5000);
    const [clip] = store.getState().issues;
    expect(clip).toMatchObject({ kind: 'clipping', channel: 1, severity: 'issue', activeSince: 5000 });
  });

  it('keeps first-seen time while the clip is held and clears it after the hold window', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveMeters: [1.3, 0.2] }), 5000);
    store.getState().ingestConsole(input({ liveMeters: [0.2, 0.2] }), 6000);
    expect(store.getState().issues[0].activeSince).toBe(5000);
    store.getState().ingestConsole(input({ liveMeters: [0.1, 0.2] }), 5000 + CLIP_HOLD_MS + 1);
    expect(store.getState().issues).toEqual([]);
  });

  it('records one fader sample per fast-tier read for the trend', () => {
    const store = createMixerStore();
    const channels = [channel(1, -10)];
    store.getState().ingestConsole(input({ liveChannels: channels, liveChannelsReadAt: 1000 }), 1000);
    store.getState().ingestConsole(input({ liveChannels: channels, liveChannelsReadAt: 1000 }), 1100);
    store.getState().ingestConsole(input({ liveChannels: [channel(1, -14)], liveChannelsReadAt: 2000 }), 2000);
    expect(store.getState().faderHistory[1]).toEqual([{ t: 1000, db: -10 }, { t: 2000, db: -14 }]);
  });

  it('records no fader sample before the first fast-tier read', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveChannelsReadAt: null }), 1000);
    expect(store.getState().faderHistory).toEqual({});
  });

  it('pauses meter rules while meters are degraded but keeps /node fader history updating', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(
      input({ liveMeters: [1.5, 1.5], link: { status: 'online', metersDegraded: true }, liveChannelsReadAt: 3000 }),
      3000
    );
    expect(store.getState().issues).toEqual([]);
    expect(store.getState().history.clipPeak).toEqual({});
    expect(store.getState().faderHistory[1]).toHaveLength(1);
  });

  it('freezes the current issues when the link goes offline and stops ingesting until it recovers', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveMeters: [1.3, 0.2] }), 5000);
    store.getState().ingestConsole(input({ liveMeters: [0.2, 1.4], link: { status: 'offline', metersDegraded: false } }), 6000);
    store.getState().ingestConsole(input({ liveMeters: [0.2, 1.6], link: { status: 'offline', metersDegraded: false } }), 7000);
    expect(store.getState().frozenIssues?.map((i) => i.key)).toEqual(['clipping:1']);
    expect(store.getState().frozenAt).toBe(6000);
    store.getState().ingestConsole(input({ liveMeters: [0.2, 1.4] }), 8000);
    expect(store.getState().frozenIssues).toBeNull();
    expect(store.getState().issues.map((i) => i.key).sort()).toEqual(['clipping:1', 'clipping:2']);
  });

  it('prunes expired dismissals on ingest', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveMeters: [1.3, 0.2] }), 5000);
    store.getState().dismissCard('clipping:1', 5000);
    store.getState().dismissCard('clipping:9', 5000);
    expect(Object.keys(store.getState().dismissals)).toEqual(['clipping:1']);
    store.getState().ingestConsole(input(), 5000 + DISMISS_MUTE_MS);
    expect(store.getState().dismissals).toEqual({});
  });
});

describe('mixerStore UI actions', () => {
  it('switches view, inspected channel, Sermon Quiet and watched mic', () => {
    const store = createMixerStore();
    store.getState().showView('buses');
    store.getState().inspectChannel(4);
    store.getState().toggleSermonQuiet();
    store.getState().watchChannel(5);
    expect(store.getState()).toMatchObject({ view: 'buses', inspected: 4, sermonQuiet: true, watched: 5 });
    store.getState().toggleSermonQuiet();
    expect(store.getState().sermonQuiet).toBe(false);
  });
});

describe('bindMixerIngest', () => {
  it('feeds every console-state change into the mixer with the injected clock', () => {
    const store = createMixerStore();
    const source = createStore<MixerConsoleInput>(() => input());
    const stop = bindMixerIngest(store, source, () => 4242);
    source.setState({ liveMeters: [1.2, 0.1] });
    expect(store.getState().issues[0]).toMatchObject({ key: 'clipping:1', activeSince: 4242 });
    stop();
    source.setState({ liveMeters: [0.1, 1.2] });
    expect(store.getState().issues.map((i) => i.key)).toEqual(['clipping:1']);
  });

  it('the app singleton listens to consoleStore', () => {
    useConsoleStore.setState({ liveChannels: [channel(1)], liveMeters: [1.5], link: ONLINE });
    expect(useMixerStore.getState().issues.map((i) => i.key)).toEqual(['clipping:1']);
    useConsoleStore.setState({ liveChannels: [], liveMeters: [], link: { status: 'unknown', metersDegraded: false } });
  });
});

describe('mixerStore proposed moves', () => {
  it('proposes no move from real frames because the over-compression rule is off', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveDynamicsGainReduction: [1, 1] }), 1000);
    store.getState().ingestConsole(input({ liveDynamicsGainReduction: [1, 1], liveMeters: [0.3, 0.3] }), 60_000);
    expect(store.getState().moves).toEqual({});
  });

  it('resolves a held move as changed on desk on the next poll, and dismissing it drops it for good', () => {
    const store = createMixerStore();
    const move = {
      key: 'over-compression:1:comp-ratio', issueKey: 'over-compression:1', channel: 1, parameter: 'comp-ratio' as const,
      from: 7, to: 5, why: 'w', expected: 'e', status: 'pending' as const,
    };
    store.setState({ moves: { [move.key]: move } });
    store.getState().ingestConsole(input(), 2000);
    expect(store.getState().moves[move.key].status).toBe('changed-on-desk');
    store.getState().dismissMove(move.key);
    expect(store.getState().moves).toEqual({});
    expect(store.getState().dismissedMoves).toEqual([move.key]);
  });
});

describe('mixerStore room curve', () => {
  const curve = Array.from({ length: 48 }, (_, i) => -40 - i * 0.5);

  it('samples the Measurement curve at most once per sample window', () => {
    const store = createMixerStore();
    store.getState().ingestRoom(curve, 1000);
    expect(store.getState().roomCurve?.db).toBe(curve);
    expect(store.getState().roomCurve?.freqs).toHaveLength(48);
    const later = curve.map((d) => d + 1);
    store.getState().ingestRoom(later, 1000 + ROOM_SAMPLE_MS - 1);
    expect(store.getState().roomCurve?.db).toBe(curve);
    store.getState().ingestRoom(later, 1000 + ROOM_SAMPLE_MS);
    expect(store.getState().roomCurve?.db).toBe(later);
  });

  it('drops the curve when the Measurement stops or the curve is not on the analyzer grid', () => {
    const store = createMixerStore();
    store.getState().ingestRoom(curve, 1000);
    store.getState().ingestRoom([1, 2, 3], 3000);
    expect(store.getState().roomCurve).toBeNull();
    store.getState().ingestRoom(null, 4000);
    expect(store.getState().roomCurve).toBeNull();
    expect(store.getState().roomCurveAt).toBeNull();
  });

  it('reads the curve only while the room-mic Measurement is active', () => {
    const active: MixerRoomInput = { secondaryMeasurement: { status: 'active' }, lastMeasurementChannels: [{ curve }] };
    expect(roomCurveOf(active)).toBe(curve);
    expect(roomCurveOf({ ...active, secondaryMeasurement: { status: 'off' } })).toBeNull();
    expect(roomCurveOf({ ...active, lastMeasurementChannels: null })).toBeNull();
    expect(roomCurveOf({ ...active, lastMeasurementChannels: [{}] })).toBeNull();
  });

  it('bindMixerRoom feeds Measurement updates with the injected clock', () => {
    const store = createMixerStore();
    const source = createStore<MixerRoomInput>(() => ({ secondaryMeasurement: { status: 'off' }, lastMeasurementChannels: null }));
    const stop = bindMixerRoom(store, source, () => 9000);
    source.setState({ secondaryMeasurement: { status: 'active' }, lastMeasurementChannels: [{ curve }] });
    expect(store.getState().roomCurveAt).toBe(9000);
    stop();
  });

  it('the app singleton listens to liveCaptureStore', () => {
    useLiveCaptureStore.setState({ secondaryMeasurement: { status: 'active', deviceName: 'UMIK-1' }, lastMeasurementChannels: [{ curve } as never] });
    expect(useMixerStore.getState().roomCurve?.db).toBe(curve);
    useLiveCaptureStore.setState({ secondaryMeasurement: { status: 'off', deviceName: '' }, lastMeasurementChannels: null });
    expect(useMixerStore.getState().roomCurve).toBeNull();
  });
});

describe('mixerStore room feedback risk', () => {
  const ringCurve = Array.from({ length: 48 }, (_, i) => (i === 35 ? -30 : -50));

  it('raises one room-level feedback card after a sustained narrow peak and keeps console issues alongside it', () => {
    const store = createMixerStore();
    store.getState().ingestConsole(input({ liveMeters: [1.3, 0.2] }), 1000);
    store.getState().ingestRoom(ringCurve, 1000);
    store.getState().ingestRoom(ringCurve, 1000 + ROOM_RING_SUSTAIN_MS);
    expect(store.getState().issues.map((i) => i.key).sort()).toEqual(['clipping:1', 'feedback-risk:room']);
    expect(store.getState().issues.find((i) => i.channel === null)?.activeSince).toBe(1000 + ROOM_RING_SUSTAIN_MS);
  });

  it('drops the room card when the Measurement stops', () => {
    const store = createMixerStore();
    store.getState().ingestRoom(ringCurve, 1000);
    store.getState().ingestRoom(ringCurve, 1000 + ROOM_RING_SUSTAIN_MS);
    store.getState().ingestRoom(null, 1000 + ROOM_RING_SUSTAIN_MS + 1);
    expect(store.getState().issues).toEqual([]);
    expect(store.getState().ring.freq).toBeNull();
  });
});
