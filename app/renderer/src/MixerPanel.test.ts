// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import MixerPanel, { MIXER_NO_CONSOLE_TITLE, MIXER_RANKED_COPY } from './MixerPanel';
import { useConsoleStore } from './stores/consoleStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useMixerStore, INITIAL_MIXER_STATE } from './stores/mixerStore';
import { useSettingsStore } from './stores/settingsStore';
import { issueKey, type MixerIssue } from './mixer/attention';
import type { AppSettings, ConsoleChannelStateDto } from '../../electron/ipc/api';

const NOW = 500_000;

function channel(index: number, name = `Ch${index}`): ConsoleChannelStateDto {
  return {
    index, name, faderDb: -5, on: true, icon: 1,
    color: { base: 'green', inverted: false },
    dynamics: { on: true, mode: 'COMP', thr: -20, ratio: 4, knee: 1, mgain: 0 },
  };
}

function clip(ch: number, magnitude: number): MixerIssue {
  return { key: issueKey('clipping', ch), kind: 'clipping', channel: ch, severity: 'issue', magnitude, activeSince: NOW - 40_000, diagnosis: `clip ${ch}` };
}

function render(): string {
  return renderToString(createElement(MixerPanel, { now: NOW }));
}

beforeEach(() => {
  useLiveCaptureStore.setState({ appMode: 'mixer' });
});

afterEach(() => {
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
  useConsoleStore.setState({
    selectedIp: null,
    liveChannels: [],
    liveMeters: [],
    liveStripDetail: [],
    liveSurfaces: null,
    link: { status: 'unknown', metersDegraded: false },
  });
  useMixerStore.setState({ ...INITIAL_MIXER_STATE });
  useSettingsStore.setState({ settings: null });
});

describe('MixerPanel shell', () => {
  it('renders nothing outside the mixer workspace', () => {
    useLiveCaptureStore.setState({ appMode: 'console' });
    expect(render()).toBe('');
  });

  it('points at the Console tab when no console is selected', () => {
    const html = render();
    expect(html).toContain(MIXER_NO_CONSOLE_TITLE);
    expect(html).toContain('id="mixer-goto-console"');
    expect(html).not.toContain('id="mixer-root"');
  });

  it('renders the mixer once a console is selected, with no console picker of its own', () => {
    useConsoleStore.setState({ selectedIp: '10.0.0.5' });
    const html = renderToString(createElement(MixerPanel));
    expect(html).toContain('id="mixer-root"');
    expect(html).not.toContain('console-scan');
    expect(html).not.toContain('console-manual-ip');
  });
});

describe('MixerPanel attention and dock', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      selectedIp: '10.0.0.5',
      liveChannels: [1, 2, 3, 4, 5].map((i) => channel(i)),
      liveMeters: [1.2, 1.1, 1.05, 1.02, 0.1],
      link: { status: 'online', metersDegraded: false },
    });
    useMixerStore.setState({ issues: [clip(1, 4), clip(2, 3), clip(3, 2), clip(4, 1)] });
  });

  it('shows three cards ranked by severity with a +N queued pill, and the rest in the dock', () => {
    const html = render();
    expect(html.match(/<article class="mx-card/g)).toHaveLength(3);
    expect(html).toContain(MIXER_RANKED_COPY);
    expect(html).not.toContain('impact on the room');
    expect(html).toContain('+1 queued · 04 Ch4 (Issue)');
    expect(html).toContain('2 channels · 1 queued');
    expect(html).toContain('mx-card mx-sev-issue mx-card-sel');
  });

  it('honours the persisted cap of 2', () => {
    useSettingsStore.setState({ settings: { mixerAttentionCap: 2 } as AppSettings });
    const html = render();
    expect(html.match(/<article class="mx-card/g)).toHaveLength(2);
    expect(html).toContain('+2 queued');
    expect(html).toContain('aria-pressed="true">2<');
  });

  it('inspects the operator-picked channel instead of the first card', () => {
    useMixerStore.setState({ inspected: 2 });
    const html = render();
    expect(html.indexOf('mx-card-sel')).toBeGreaterThan(html.indexOf('data-card-key="clipping:1"'));
  });

  it('shows the frozen snapshot while offline', () => {
    useConsoleStore.setState({ link: { status: 'offline', metersDegraded: false } });
    useMixerStore.setState({ frozenIssues: [clip(5, 9)] });
    const html = render();
    expect(html).toContain('data-card-key="clipping:5"');
    expect(html).not.toContain('data-card-key="clipping:1"');
    expect(html).toContain('mx-card-dismiss" disabled=""');
  });

  it('shows the live cards while offline when no snapshot was taken', () => {
    useConsoleStore.setState({ link: { status: 'offline', metersDegraded: false } });
    expect(render()).toContain('data-card-key="clipping:1"');
  });

  it('marks meters unavailable on cards and tiles while meters are degraded', () => {
    useConsoleStore.setState({ link: { status: 'online', metersDegraded: true } });
    expect(render()).toContain('Meters unavailable');
  });

  it('renders the rules-only rail beside the main column, naming the console model it reads', () => {
    useConsoleStore.setState({ identity: { ip: '10.0.0.5', model: 'X32', firmware: '4.0' } });
    useMixerStore.setState({ roomCurve: { freqs: [20, 2000, 20000], db: [-40, -30, -50] } });
    const html = render();
    expect(html).toContain('id="mixer-rail"');
    expect(html).toContain('Reading: X32 channel poll · input meters · room mic RTA');
    expect(html).toContain('lower the input gain');
    useConsoleStore.setState({ identity: null });
  });

  it('opens the inspector on the first card with every no-source panel unavailable', () => {
    const html = render();
    expect(html).toContain('id="mixer-inspector"');
    expect(html).toContain('Channel spectrum unavailable');
    expect(html).toContain('Masking unavailable');
    expect(html).toContain('Share of Main LR unavailable');
  });

  it('draws the room RTA in the inspector while the room mic is listening', () => {
    useMixerStore.setState({ roomCurve: { freqs: [20, 2000, 20000], db: [-40, -30, -50] } });
    expect(render()).toContain('id="mixer-room-rta"');
  });

  it('falls back to the first channel, or to the pick prompt, when no card names a channel', () => {
    useMixerStore.setState({ issues: [], view: 'all' });
    expect(render()).toMatch(/id="mixer-inspector"[^>]*><div class="mx-spec">/);
    useConsoleStore.setState({ liveChannels: [] });
    useMixerStore.setState({ issues: [], view: 'all' });
    expect(render()).toContain('mx-insp mx-insp-empty');
  });

  it('shows no queued pill when every issue fits', () => {
    useMixerStore.setState({ issues: [clip(1, 4)] });
    expect(render()).not.toContain('id="mixer-queued"');
  });
});

describe('MixerPanel views', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      selectedIp: '10.0.0.5',
      identity: { ip: '10.0.0.5', model: 'X32', firmware: '4.0' },
      liveStateStatus: 'watching',
      liveChannels: [1, 2, 3].map((i) => channel(i)),
      liveMeters: [0.1, 0.1, 0.1],
      link: { status: 'online', metersDegraded: false },
    });
    useMixerStore.setState({ issues: [] });
  });

  it('shows the calm state, the board and the routing overview when no card is visible', () => {
    const html = render();
    expect(html).toContain('No urgent issues detected');
    expect(html).toContain('Clipping: watching 3 inputs on the console meters');
    expect(html).toContain('id="mixer-board"');
    expect(html).toContain('Board · 3 channels');
    expect(html).toContain('id="mixer-routing"');
    expect(html).not.toContain('id="mixer-cards"');
    expect(html).toContain('Connected: X32 · 3 ch');
  });

  it('does not show the calm banner while any card is visible', () => {
    useMixerStore.setState({ issues: [clip(1, 2)] });
    expect(render()).not.toContain('No urgent issues detected');
  });

  it('shows the All Channels board with the inspector', () => {
    useMixerStore.setState({ view: 'all' });
    const html = render();
    expect(html).toContain('All channels · 3');
    expect(html).toContain('id="mixer-inspector"');
  });

  it('shows the Buses view built from parsed sends and surfaces', () => {
    useConsoleStore.setState({
      liveSurfaces: {
        buses: [{ kind: 'bus', index: 1, name: { value: 'IEM1', readAt: NOW - 1000 }, mix: { value: { on: true, faderDb: -3 }, readAt: NOW - 1000 } }],
        main: { kind: 'main', index: null, name: null, mix: null },
      },
      liveStripDetail: [{ index: 2, preamp: null, gate: null, eq: null, sends: { value: [{ bus: 1, on: true, level: -6 }], readAt: NOW - 2000 } }],
    });
    useMixerStore.setState({ view: 'buses' });
    const html = render();
    expect(html).toContain('id="mixer-buses"');
    expect(html).toContain('IEM1');
    expect(html).toContain('02 Ch2');
    expect(html).toContain('Buses<span class="mx-seg-n">1</span>');
  });
});

describe('MixerPanel Sermon Quiet and room ring', () => {
  const ROOM_CURVE = { freqs: [20, 2000, 20000], db: [-40, -30, -50] };
  const RING_ISSUE: MixerIssue = { key: 'feedback-risk:room', kind: 'feedback-risk', channel: null, severity: 'issue', magnitude: 12, activeSince: NOW - 8000, diagnosis: 'Room ring near 2.5 kHz' };

  beforeEach(() => {
    useConsoleStore.setState({
      selectedIp: '10.0.0.5',
      identity: { ip: '10.0.0.5', model: 'X32', firmware: '4.0' },
      liveStateStatus: 'watching',
      liveChannels: [1, 5].map((i) => channel(i, i === 5 ? 'Pastor HH' : 'Lead Vox')),
      liveMeters: [0.1, 0.1],
      link: { status: 'online', metersDegraded: false },
    });
  });

  it('with the watch live: gold banner, only the room feedback card, watched mic in gold, others dimmed, rail held line', () => {
    useMixerStore.setState({
      sermonQuiet: true,
      watched: 5,
      roomCurve: ROOM_CURVE,
      ring: { freq: 2500, prominence: 12, since: NOW - 8000 },
      issues: [RING_ISSUE, clip(1, 3), clip(5, 2)],
    });
    const html = render();
    expect(html).toContain('Sermon Quiet active — feedback watch only');
    expect(html).toContain('Watching 05 Pastor HH');
    expect(html).toContain('2 alerts held for later');
    expect(html).toContain('data-card-key="feedback-risk:room"');
    expect(html).not.toContain('data-card-key="clipping:1"');
    expect(html).toContain('Room ring near 2.5 kHz');
    expect(html).toContain('Open channels (candidates, not confirmed): 05 Pastor HH, 01 Lead Vox');
    expect(html).toContain('mx-tile-watch');
    expect(html).toContain('mx-tile-dim');
    expect(html).toContain('Only feedback risk will interrupt · 2 held');
    expect(html).toContain('Sermon Quiet · Feedback only');
    expect(html).not.toMatch(/margin/i);
  });

  it('with no room spectrum: the banner says the feedback watch is unavailable', () => {
    useMixerStore.setState({ sermonQuiet: true, issues: [clip(1, 3)] });
    const html = render();
    expect(html).toContain('Sermon Quiet active — feedback watch unavailable — room mic is not listening');
    expect(html).not.toContain('id="mixer-cards"');
    expect(html).toContain('room mic not listening');
  });

  it('outside Sermon Quiet the room ring shows as a normal card and marks the inspector RTA', () => {
    useMixerStore.setState({ roomCurve: ROOM_CURVE, ring: { freq: 2500, prominence: 12, since: NOW - 8000 }, issues: [RING_ISSUE, clip(1, 3)], inspected: 1 });
    const html = render();
    expect(html).toContain('data-card-key="feedback-risk:room"');
    expect(html).toContain('Ring near 2.5 kHz');
    expect(html).toContain('Room ring near 2.5 kHz: bring down the open mic');
  });
});

describe('MixerPanel degraded link', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      selectedIp: '10.0.0.5',
      identity: { ip: '10.0.0.5', model: 'X32', firmware: '4.0' },
      liveStateStatus: 'watching',
      liveChannels: [1, 2].map((i) => channel(i)),
      liveMeters: [0.1, 0.1],
      link: { status: 'online', metersDegraded: false },
    });
  });

  it('offline: red chip, Reconnect, frozen cards, disabled moves, and an explanatory notice', () => {
    useConsoleStore.setState({ link: { status: 'offline', metersDegraded: false } });
    useMixerStore.setState({ frozenIssues: [clip(2, 3)], frozenAt: NOW - 30_000 });
    const html = render();
    expect(html).toContain('mx-conn mx-conn-offline');
    expect(html).toContain('Offline: X32');
    expect(html).toContain('id="mixer-reconnect"');
    expect(html).toContain('Cards are frozen for 0:30 and moves are disabled');
    expect(html).toContain('Reading: X32 offline');
    expect(html).toContain('data-card-key="clipping:2"');
    expect(html).toContain('mx-card-dismiss" disabled=""');
  });

  it('recovers: back online, the notice and Reconnect go away', () => {
    useMixerStore.setState({ issues: [clip(1, 3)] });
    const html = render();
    expect(html).not.toContain('id="mixer-link-notice"');
    expect(html).not.toContain('id="mixer-reconnect"');
    expect(html).toContain('Connected: X32 · 2 ch');
  });

  it('meters degraded: Meters unavailable, meter checks paused, /node data still shown', () => {
    useConsoleStore.setState({ link: { status: 'online', metersDegraded: true } });
    useMixerStore.setState({ issues: [] });
    const html = render();
    expect(html).toContain('Meters unavailable. Meter checks are paused; channel state is still being read from the console.');
    expect(html).toContain('Clipping: paused while console meters are unavailable');
    expect(html).toContain('Connected: X32 · 2 ch');
    expect(html).toContain('Reading: X32 channel poll · input meters unavailable');
  });

  it('not watching: offers Start watching instead of a picker', () => {
    useConsoleStore.setState({ liveStateStatus: 'idle', link: { status: 'unknown', metersDegraded: false } });
    const html = render();
    expect(html).toContain('Not watching: X32');
    expect(html).toContain('id="mixer-start-watching"');
  });
});
