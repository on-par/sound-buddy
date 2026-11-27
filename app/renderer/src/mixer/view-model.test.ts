// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  scribbleView,
  channelName,
  channelLabel,
  formatDb,
  faderPercent,
  meterPercent,
  meterSlot,
  formatClock,
  formatReadAge,
  appendFaderSamples,
  faderTrend,
  busName,
  activeSendBuses,
  sendsLabel,
  compLabel,
  cardView,
  queuedPill,
  dockView,
  readBuses,
  severityLabel,
  kindLabel,
  railContextLine,
  railView,
  toolbarView,
  calmChecks,
  CALM_TITLE,
  sermonBanner,
  linkNotice,
  SERMON_TITLE_LIVE,
  SERMON_TITLE_UNAVAILABLE,
  FADER_HISTORY_LIMIT,
  SENDS_NOT_READ,
  SHARE_OF_MIX_UNAVAILABLE,
  BUS_METERS_UNAVAILABLE,
  MAIN_LUFS_UNAVAILABLE,
  type CardContext,
  type DockContext,
} from './view-model';
import { selectAttention, issueKey, type MixerIssue } from './attention';
import { GR_UNAVAILABLE_LABEL, METERS_UNAVAILABLE_LABEL } from './rules';
import type { ConsoleChannelStateDto, ConsoleStripDetailDto, ConsoleSurfacesDto } from '../../../electron/ipc/api';

const NOW = 200_000;

function ch(index: number, over: Partial<ConsoleChannelStateDto> = {}): ConsoleChannelStateDto {
  return {
    index, name: `Vox ${index}`, faderDb: -6.5, on: true, icon: 1,
    color: { base: 'yellow', inverted: false },
    dynamics: { on: true, mode: 'COMP', thr: -28, ratio: 6, knee: 1, mgain: 0 },
    ...over,
  };
}

function surfaces(): ConsoleSurfacesDto {
  return {
    buses: [
      { kind: 'bus', index: 1, name: { value: 'Vox Bus', readAt: NOW - 4000 }, mix: { value: { on: true, faderDb: -2 }, readAt: NOW - 2000 } },
      { kind: 'bus', index: 2, name: { value: '', readAt: NOW - 1000 }, mix: { value: { on: false, faderDb: -Infinity }, readAt: NOW - 1000 } },
      { kind: 'bus', index: 3, name: null, mix: null },
    ],
    main: { kind: 'main', index: null, name: null, mix: null },
  };
}

function detail(index: number, sends: ConsoleStripDetailDto['sends']): ConsoleStripDetailDto {
  return { index, preamp: null, gate: null, eq: null, sends };
}

function issue(over: Partial<MixerIssue> & Pick<MixerIssue, 'kind' | 'channel'>): MixerIssue {
  return {
    key: issueKey(over.kind, over.channel),
    severity: 'issue',
    magnitude: 1,
    activeSince: NOW - 40_000,
    diagnosis: 'diag',
    ...over,
  };
}

function ctx(over: Partial<CardContext> = {}): CardContext {
  return {
    channels: [ch(1), ch(2, { dynamics: { on: false, mode: 'COMP', thr: 0, ratio: 3, knee: 1, mgain: 0 } })],
    meters: [0.5, 1],
    metersAvailable: true,
    stripDetail: [detail(1, { value: [{ bus: 1, on: true, level: -3 }, { bus: 2, on: true, level: -Infinity }], readAt: NOW - 12_000 })],
    surfaces: surfaces(),
    faderHistory: { 1: [{ t: NOW - 120_000, db: -2.5 }, { t: NOW, db: -6.5 }] },
    clipPeaks: { 1: 1.4 },
    ring: null,
    inspected: 1,
    now: NOW,
    ...over,
  };
}

describe('scribble and labels', () => {
  it('maps the board colour token to a class and keeps name, number, icon and inversion', () => {
    expect(scribbleView(ch(1), 1)).toEqual({ number: '01', name: 'Vox 1', colorClass: 'mx-c-yellow', inverted: false, icon: 1 });
    expect(scribbleView(ch(3, { color: { base: 'blue', inverted: true }, icon: null }), 3)).toMatchObject({ colorClass: 'mx-c-blue', inverted: true, icon: null });
  });

  it('uses the neutral class for an unknown colour and Ch N for an empty name or missing channel', () => {
    expect(scribbleView(ch(4, { name: '  ', color: { base: null, inverted: false } }), 4)).toMatchObject({ name: 'Ch 4', colorClass: 'mx-c-neutral' });
    expect(scribbleView(undefined, 12)).toEqual({ number: '12', name: 'Ch 12', colorClass: 'mx-c-neutral', inverted: false, icon: null });
    expect(channelName(undefined, 7)).toBe('Ch 7');
    expect(channelLabel([ch(1)], 1)).toBe('01 Vox 1');
  });

  it('labels severity and kind', () => {
    expect([severityLabel('issue'), severityLabel('check'), severityLabel('info')]).toEqual(['Issue', 'Check', 'Info']);
    expect([kindLabel('clipping'), kindLabel('over-compression'), kindLabel('feedback-risk')]).toEqual(['Clipping', 'Over-compression', 'Feedback risk']);
  });
});

describe('formatting', () => {
  it('formats dB with sign and the fully-down fader', () => {
    expect([formatDb(-6.5), formatDb(2), formatDb(0), formatDb(-Infinity)]).toEqual(['-6.5 dB', '+2.0 dB', '0.0 dB', '-∞ dB']);
  });

  it('maps fader dB onto the drawn travel, piecewise and clamped', () => {
    expect(faderPercent(10)).toBe(100);
    expect(faderPercent(12)).toBe(100);
    expect(faderPercent(0)).toBe(75);
    expect(faderPercent(-5)).toBeCloseTo(62.5, 5);
    expect(faderPercent(-60)).toBe(6);
    expect(faderPercent(-90)).toBeCloseTo(3, 5);
    expect(faderPercent(-200)).toBe(0);
    expect(faderPercent(-Infinity)).toBe(0);
  });

  it('maps a meter value onto a -60..0 dBFS bar', () => {
    expect(meterPercent(1)).toBe(100);
    expect(meterPercent(4)).toBe(100);
    expect(meterPercent(0)).toBe(0);
    expect(meterPercent(0.001)).toBe(0);
    expect(meterPercent(0.1)).toBeCloseTo(66.67, 1);
  });

  it('builds a meter slot, or the unavailable label when meters are degraded', () => {
    expect(meterSlot([0.5], true, 1)).toMatchObject({ available: true, label: '-6.0 dBFS' });
    expect(meterSlot([], true, 2)).toEqual({ available: true, percent: 0, label: '-∞ dBFS' });
    expect(meterSlot([0.5], false, 1)).toEqual({ available: false, percent: 0, label: METERS_UNAVAILABLE_LABEL });
  });

  it('formats a clock and a read age', () => {
    expect([formatClock(40_000), formatClock(352_000), formatClock(3_723_000), formatClock(-5)]).toEqual(['0:40', '5:52', '1:02:03', '0:00']);
    expect(formatReadAge(NOW - 12_000, NOW)).toBe('read 12 s ago');
    expect(formatReadAge(NOW - 185_000, NOW)).toBe('read 3 min ago');
    expect(formatReadAge(NOW + 5, NOW)).toBe('read 0 s ago');
  });
});

describe('fader trend from poll history', () => {
  it('appends one sample per read, skipping a duplicate read time, and caps the history', () => {
    let h = appendFaderSamples({}, [ch(1)], 1000);
    h = appendFaderSamples(h, [ch(1, { faderDb: -9 })], 1000);
    expect(h[1]).toEqual([{ t: 1000, db: -6.5 }]);
    for (let t = 2; t < FADER_HISTORY_LIMIT + 10; t++) h = appendFaderSamples(h, [ch(1)], t * 1000);
    expect(h[1]).toHaveLength(FADER_HISTORY_LIMIT);
  });

  it('reports the change across the trend window', () => {
    expect(faderTrend([{ t: NOW - 120_000, db: -2.5 }, { t: NOW - 60_000, db: -4 }, { t: NOW, db: -6.5 }], NOW)).toBe('-4.0 dB in 2:00');
    expect(faderTrend([{ t: NOW - 30_000, db: -8 }, { t: NOW, db: -6 }], NOW)).toBe('+2.0 dB in 0:30');
  });

  it('falls back to the last two samples when the window has fewer than two', () => {
    expect(faderTrend([{ t: NOW - 500_000, db: -10 }, { t: NOW - 400_000, db: -9 }], NOW)).toBe('+1.0 dB in 1:40');
  });

  it('says steady, collecting, or shows the fully-down endpoints', () => {
    expect(faderTrend([{ t: NOW - 10_000, db: -6 }, { t: NOW, db: -6.01 }], NOW)).toBe('Steady over 0:10');
    expect(faderTrend([{ t: NOW, db: -6 }], NOW)).toBe('Collecting poll history');
    expect(faderTrend(undefined, NOW)).toBe('Collecting poll history');
    expect(faderTrend([{ t: NOW - 10_000, db: -Infinity }, { t: NOW, db: -Infinity }], NOW)).toBe('Steady over 0:10');
    expect(faderTrend([{ t: NOW - 10_000, db: -Infinity }, { t: NOW, db: -10 }], NOW)).toBe('-∞ dB → -10.0 dB in 0:10');
  });
});

describe('sends and buses', () => {
  it('names buses from /node, falling back to Bus N', () => {
    const s = surfaces();
    expect([busName(s, 1), busName(s, 2), busName(s, 3), busName(null, 4)]).toEqual(['Vox Bus', 'Bus 2', 'Bus 3', 'Bus 4']);
  });

  it('lists active sends only: on with a finite level', () => {
    expect(activeSendBuses(detail(1, { value: [{ bus: 1, on: true, level: -3 }, { bus: 2, on: false, level: 0 }, { bus: 3, on: true, level: -Infinity }], readAt: 0 }))).toEqual([1]);
    expect(activeSendBuses(detail(1, null))).toBeNull();
    expect(activeSendBuses(undefined)).toBeNull();
  });

  it('names each bus once when linked buses share a name', () => {
    const s = surfaces();
    s.buses[1] = { ...s.buses[1], name: { value: 'Vox Bus', readAt: NOW } };
    expect(sendsLabel(detail(1, { value: [{ bus: 1, on: true, level: -3 }, { bus: 2, on: true, level: -3 }], readAt: NOW }), s, NOW)).toBe('Sends to: Vox Bus · read 0 s ago');
  });

  it('labels sends with their read age, or as not read yet', () => {
    const s = surfaces();
    expect(sendsLabel(detail(1, { value: [{ bus: 1, on: true, level: -3 }], readAt: NOW - 12_000 }), s, NOW)).toBe('Sends to: Vox Bus · read 12 s ago');
    expect(sendsLabel(detail(1, { value: [], readAt: NOW - 1000 }), s, NOW)).toBe('No active sends · read 1 s ago');
    expect(sendsLabel(detail(1, null), s, NOW)).toBe(SENDS_NOT_READ);
    expect(sendsLabel(undefined, s, NOW)).toBe(SENDS_NOT_READ);
  });

  it('lists only buses whose name and mix have both been read, with the older read age', () => {
    expect(readBuses(surfaces(), NOW)).toEqual([
      { index: 1, name: 'Vox Bus', fader: '-2.0 dB', on: true, age: 'read 4 s ago' },
      { index: 2, name: 'Bus 2', fader: '-∞ dB', on: false, age: 'read 1 s ago' },
    ]);
    expect(readBuses(null, NOW)).toEqual([]);
  });

  it('labels the compressor from the live dyn read', () => {
    expect(compLabel(ch(1))).toBe('6.0:1 · thr -28.0 dB');
    expect(compLabel(ch(1, { dynamics: { on: false, mode: 'COMP', thr: 0, ratio: 3, knee: 1, mgain: 0 } }))).toBe('Off');
    expect(compLabel(undefined)).toBe('Not read yet');
  });
});

describe('cardView', () => {
  it('builds a clipping card from real values only, with GR and share marked unavailable', () => {
    const card = cardView(issue({ kind: 'clipping', channel: 1, diagnosis: 'Input is hitting digital full scale (peak +2.9 dBFS)' }), ctx());
    expect(card).toMatchObject({
      key: 'clipping:1',
      scribble: { number: '01', name: 'Vox 1', colorClass: 'mx-c-yellow' },
      pillLabel: 'Issue · Clipping',
      age: '0:40',
      fader: { label: '-6.5 dB' },
      level: { available: true, label: '-6.0 dBFS' },
      grLabel: GR_UNAVAILABLE_LABEL,
      sends: 'Sends to: Vox Bus · read 12 s ago',
      share: SHARE_OF_MIX_UNAVAILABLE,
      candidates: [],
      inspected: true,
    });
    expect(card.facts).toEqual([
      { label: 'Peak level', value: '+2.9 dBFS', tone: 'issue' },
      { label: 'Comp', value: '6.0:1 · thr -28.0 dB', tone: null },
      { label: 'Fader trend', value: '-4.0 dB in 2:00', tone: null },
    ]);
  });

  it('shows a dash for a clip peak that is no longer held', () => {
    expect(cardView(issue({ kind: 'clipping', channel: 2 }), ctx()).facts[0].value).toBe('—');
  });

  it('builds an over-compression card with its GR figure as a fact', () => {
    const card = cardView(issue({ kind: 'over-compression', channel: 2, severity: 'check', magnitude: 12 }), ctx());
    expect(card.pillLabel).toBe('Check · Over-compression');
    expect(card.facts[0]).toEqual({ label: 'Gain reduction', value: '-12.0 dB', tone: 'check' });
    expect(card.facts[1].value).toBe('Off');
    expect(card.inspected).toBe(false);
    expect(card.sends).toBe(SENDS_NOT_READ);
  });

  it('renders no meter or fader for a card whose channel has not been read', () => {
    const card = cardView(issue({ kind: 'clipping', channel: 9 }), ctx({ metersAvailable: false }));
    expect(card.fader).toBeNull();
    expect(card.level.label).toBe(METERS_UNAVAILABLE_LABEL);
  });

  it('builds a room-level feedback card with no scribble and the open channels as candidates', () => {
    const ring = { freqLabel: '2.5 kHz', prominenceDb: 12.3, candidates: ['01 Vox 1'] };
    const card = cardView(issue({ kind: 'feedback-risk', channel: null, diagnosis: 'Room ring near 2.5 kHz' }), ctx({ ring }));
    expect(card.scribble).toBeNull();
    expect(card.fader).toBeNull();
    expect(card.level.available).toBe(false);
    expect(card.sends).toBe('');
    expect(card.candidates).toEqual(['01 Vox 1']);
    expect(card.facts).toEqual([
      { label: 'Ring', value: '2.5 kHz', tone: 'issue' },
      { label: 'Stands out by', value: '+12.3 dB', tone: null },
      { label: 'Source', value: 'Room mic RTA', tone: null },
    ]);
    expect(card.inspected).toBe(false);
  });

  it('shows dashes on a room card whose ring data is gone', () => {
    const card = cardView(issue({ kind: 'feedback-risk', channel: null }), ctx());
    expect(card.facts.slice(0, 2).map((f) => f.value)).toEqual(['—', '—']);
    expect(card.candidates).toEqual([]);
  });
});

describe('queued pill and dock', () => {
  const issues = [
    issue({ kind: 'clipping', channel: 1, magnitude: 5 }),
    issue({ kind: 'clipping', channel: 2, magnitude: 4 }),
    issue({ kind: 'clipping', channel: 3, magnitude: 3 }),
    issue({ kind: 'over-compression', channel: 14, severity: 'info' }),
  ];
  const channels = [1, 2, 3, 4, 14].map((i) => ch(i));

  function dctx(over: Partial<DockContext> = {}): DockContext {
    return { channels, meters: [0.2, 0.2, 0.2, 0.1], metersAvailable: true, surfaces: surfaces(), watched: null, sermonQuiet: false, now: NOW, ...over };
  }

  it('names the first queued strip and its severity', () => {
    expect(queuedPill(selectAttention({ issues, now: NOW }), channels)).toEqual({ label: '+1 queued · 14 Vox 14 (Info)', severity: 'info' });
    expect(queuedPill(selectAttention({ issues: issues.slice(0, 2), now: NOW }), channels)).toBeNull();
    const room = issue({ kind: 'feedback-risk', channel: null, severity: 'info' });
    expect(queuedPill(selectAttention({ issues: [...issues.slice(0, 3), room], now: NOW }), channels)?.label).toBe('+1 queued · Room (Info)');
  });

  it('puts queued strips first tinted by severity, then every other channel not on a card', () => {
    const dock = dockView(selectAttention({ issues, now: NOW }), dctx());
    expect(dock.header).toBe('2 channels · 1 queued');
    expect(dock.tiles.map((t) => [t.channel, t.queuedSeverity])).toEqual([[14, 'info'], [4, null]]);
    expect(dock.tiles[1].level.label).toBe('-20.0 dBFS');
    expect(dock.buses.map((b) => b.name)).toEqual(['Vox Bus', 'Bus 2']);
    expect(dock.busMeters).toBe(BUS_METERS_UNAVAILABLE);
    expect(dock.mainLufs).toBe(MAIN_LUFS_UNAVAILABLE);
  });

  it('ignores a room-level queued item when tinting tiles and keeps the first severity per strip', () => {
    const room = issue({ kind: 'feedback-risk', channel: null, severity: 'info', magnitude: 0 });
    const twice = [issue({ kind: 'clipping', channel: 4, magnitude: 1 }), issue({ kind: 'over-compression', channel: 4, severity: 'check' })];
    const dock = dockView(selectAttention({ issues: [...issues.slice(0, 3), room, ...twice], now: NOW }), dctx());
    expect(dock.tiles.find((t) => t.channel === 4)?.queuedSeverity).toBe('issue');
  });

  it('dims every strip but the watched mic in Sermon Quiet', () => {
    const dock = dockView(selectAttention({ issues: [], now: NOW }), dctx({ sermonQuiet: true, watched: 4 }));
    expect(dock.tiles.filter((t) => !t.dimmed).map((t) => t.channel)).toEqual([4]);
    expect(dock.tiles.find((t) => t.channel === 4)?.watched).toBe(true);
  });
});

describe('rail view', () => {
  const sources = { model: 'X32', channelsRead: true, metersAvailable: true, roomListening: false };

  it('names the real sources in use', () => {
    expect(railContextLine(sources)).toBe('Reading: X32 channel poll · input meters · room mic not listening');
    expect(railContextLine({ ...sources, offline: true })).toBe('Reading: X32 offline · input meters · room mic not listening');
    expect(railContextLine({ model: null, channelsRead: false, metersAvailable: false, roomListening: true })).toBe(
      'Reading: console channel poll (waiting for first read) · input meters unavailable · room mic RTA'
    );
  });

  it('turns visible clipping and room cards into advice, numbers moves, and carries the Sermon Quiet held count', () => {
    const attention = selectAttention({
      now: NOW,
      sermonQuiet: true,
      issues: [issue({ kind: 'feedback-risk', channel: null }), issue({ kind: 'clipping', channel: 1 }), issue({ kind: 'over-compression', channel: 2, severity: 'check' })],
    });
    const moves = {
      b: { key: 'b', issueKey: 'over-compression:2', channel: 2, parameter: 'comp-ratio' as const, from: 7, to: 5, why: 'w', expected: 'e', status: 'changed-on-desk' as const },
      a: { key: 'a', issueKey: 'over-compression:2', channel: 2, parameter: 'comp-threshold' as const, from: -20, to: -17, why: 'w', expected: 'e', status: 'pending' as const },
      c: { key: 'c', issueKey: 'over-compression:1', channel: 1, parameter: 'comp-ratio' as const, from: 7, to: 5, why: 'w', expected: 'e', status: 'pending' as const },
    };
    const rail = railView(attention, moves, [ch(1), ch(2)], { sources, sermonQuiet: true, ringFreq: '2.5 kHz' });
    expect(rail.sermonLine).toBe('Only feedback risk will interrupt · 2 held');
    expect(rail.advice.map((a) => a.text.slice(0, 22))).toEqual(['Room ring near 2.5 kHz']);
    expect(rail.moves.map((m) => [m.key, m.position, m.changedOnDesk])).toEqual([['c', '1 of 3', false], ['a', '2 of 3', false], ['b', '3 of 3', true]]);
    expect(rail.moves[0].scribble.name).toBe('Vox 1');
    expect(rail.moves[0].param).toBe('Comp ratio 7.0:1 → 5.0:1');
    expect(rail.frozen).toBe(false);
  });

  it('gives clipping advice by channel and none for over-compression outside Sermon Quiet', () => {
    const attention = selectAttention({ now: NOW, issues: [issue({ kind: 'clipping', channel: 1 }), issue({ kind: 'over-compression', channel: 2, severity: 'check' })] });
    const rail = railView(attention, {}, [ch(1)], { sources, sermonQuiet: false, ringFreq: null });
    expect(rail.sermonLine).toBeNull();
    expect(rail.advice).toHaveLength(1);
    expect(rail.advice[0].text).toMatch(/^01 Vox 1: lower the input gain/);
    expect(rail.moves).toEqual([]);
  });
});

describe('toolbar view', () => {
  const attention = selectAttention({ now: NOW, issues: [1, 2, 3, 4].map((c) => issue({ kind: 'clipping', channel: c })) });
  const base = { model: 'X32', liveStateStatus: 'watching' as const, link: { status: 'online' as const }, channelCount: 32, attention, busesRead: 4 };

  it('says Connected with the model and channel count from the console, and real filter counts', () => {
    expect(toolbarView(base)).toEqual({
      chipState: 'connected',
      chipText: 'Connected: X32 · 32 ch',
      showStart: false,
      showReconnect: false,
      counts: { attention: 4, all: 32, buses: 4 },
    });
  });

  it('never claims a sample rate, scene or section', () => {
    expect(toolbarView(base).chipText).not.toMatch(/kHz|Scene|Section/);
  });

  it('turns red with a Reconnect action when the console is offline', () => {
    expect(toolbarView({ ...base, link: { status: 'offline' } })).toMatchObject({ chipState: 'offline', chipText: 'Offline: X32', showReconnect: true, showStart: false });
  });

  it('offers Start watching when nothing is being watched', () => {
    expect(toolbarView({ ...base, liveStateStatus: 'idle', model: null })).toMatchObject({ chipState: 'idle', chipText: 'Not watching: console', showStart: true });
    expect(toolbarView({ ...base, liveStateStatus: 'error' }).chipState).toBe('idle');
  });

  it('says Connecting until the link is known and channels arrive', () => {
    expect(toolbarView({ ...base, liveStateStatus: 'starting', link: { status: 'unknown' } }).chipText).toBe('Connecting: X32');
    expect(toolbarView({ ...base, channelCount: 0 }).chipState).toBe('connecting');
  });
});

describe('calm checks', () => {
  it('lists the checks that are actually running, without claiming every channel is clean', () => {
    expect(calmChecks({ channelCount: 32, metersAvailable: true, roomListening: true })).toEqual([
      'Clipping: watching 32 inputs on the console meters',
      'Over-compression: off until the GR meter scale is established',
      'Room ring: watching the room mic',
    ]);
    expect(calmChecks({ channelCount: 32, metersAvailable: false, roomListening: false })).toEqual([
      'Clipping: paused while console meters are unavailable',
      'Over-compression: off until the GR meter scale is established',
      'Room ring: off, the room mic is not listening',
    ]);
    expect(CALM_TITLE).toBe('No urgent issues detected');
  });
});

describe('Sermon Quiet banner', () => {
  it('reads feedback watch only while the room mic is listening, with the watched mic and held count', () => {
    expect(sermonBanner({ watchLive: true, watchedLabel: '05 Pastor HH', heldCount: 3 })).toEqual({
      live: true,
      title: SERMON_TITLE_LIVE,
      body: 'Watching 05 Pastor HH; other strips are dimmed. Clipping and compression alerts are held for later.',
      held: '3 alerts held for later',
    });
  });

  it('says the watch is unavailable when the room mic is not listening, and asks for a watched mic', () => {
    const banner = sermonBanner({ watchLive: false, watchedLabel: null, heldCount: 1 });
    expect(banner.title).toBe('Sermon Quiet active — feedback watch unavailable — room mic is not listening');
    expect(banner.title).toBe(SERMON_TITLE_UNAVAILABLE);
    expect(banner.body).toMatch(/^Start the room mic listen.*Pick the mic to watch/);
    expect(banner.held).toBe('1 alert held for later');
  });

  it('never shows a feedback margin figure', () => {
    const banner = sermonBanner({ watchLive: true, watchedLabel: '05 Pastor HH', heldCount: 0 });
    expect(JSON.stringify(banner)).not.toMatch(/margin|dB/);
  });
});

describe('link notice', () => {
  it('explains the frozen offline state with how long it has been frozen', () => {
    expect(linkNotice({ link: { status: 'offline', metersDegraded: false }, frozenAt: NOW - 12_000, now: NOW })).toEqual({
      tone: 'issue',
      text: 'Console offline. Cards are frozen for 0:12 and moves are disabled. Check the console is on this network, then press Reconnect.',
    });
    expect(linkNotice({ link: { status: 'offline', metersDegraded: true }, frozenAt: null, now: NOW })?.text).toMatch(/^Console offline\. Cards are frozen and moves/);
  });

  it('says meters are unavailable while /node keeps updating', () => {
    expect(linkNotice({ link: { status: 'online', metersDegraded: true }, frozenAt: null, now: NOW })).toEqual({
      tone: 'check',
      text: 'Meters unavailable. Meter checks are paused; channel state is still being read from the console.',
    });
  });

  it('is silent when the link is healthy or not yet known', () => {
    expect(linkNotice({ link: { status: 'online', metersDegraded: false }, frozenAt: null, now: NOW })).toBeNull();
    expect(linkNotice({ link: { status: 'unknown', metersDegraded: false }, frozenAt: null, now: NOW })).toBeNull();
  });
});
