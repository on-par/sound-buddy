// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  signalChain,
  rtaPath,
  spectrumWell,
  inspectorView,
  CHANNEL_SPECTRUM_UNAVAILABLE,
  ROOM_RTA_LABEL,
  MASKING_UNAVAILABLE,
  SHARE_OF_MAIN_UNAVAILABLE,
  NOT_READ_YET,
  RTA_WIDTH,
} from './inspector';
import type { ConsoleChannelStateDto, ConsoleStripDetailDto, ConsoleSurfacesDto } from '../../../electron/ipc/api';
import type { ProposedMove } from './proposed-moves';

const NOW = 100_000;

const CH: ConsoleChannelStateDto = {
  index: 1, name: 'Lead Vox', faderDb: -6.5, on: true, icon: 1, color: { base: 'yellow', inverted: false },
  dynamics: { on: true, mode: 'COMP', thr: -23, ratio: 5, knee: 1, mgain: 0 },
};

const DETAIL: ConsoleStripDetailDto = {
  index: 1,
  preamp: { value: { trim: 0, invert: false, hpf: { on: true, slope: 24, freq: 178 } }, readAt: NOW - 3000 },
  gate: { value: { on: true, mode: 'GATE', thr: -80, range: 60, attack: 10, hold: 50.2, release: 258 }, readAt: NOW - 3000 },
  eq: {
    value: { on: true, bands: [{ type: 'PEQ', freq: '328.1', gain: -6.25, q: 2 }, { type: 'PEQ', freq: '1k09', gain: 2, q: 2 }] },
    readAt: NOW - 4000,
  },
  sends: { value: [{ bus: 1, on: true, level: -9.8 }], readAt: NOW - 20_000 },
};

const SURFACES: ConsoleSurfacesDto = {
  buses: [{ kind: 'bus', index: 1, name: { value: 'IEM1', readAt: NOW - 1000 }, mix: null }],
  main: { kind: 'main', index: null, name: null, mix: { value: { on: true, faderDb: -4.3 }, readAt: NOW - 7000 } },
};

const MOVE: ProposedMove = { key: 'over-compression:1:comp-ratio', issueKey: 'over-compression:1', channel: 1, parameter: 'comp-ratio', from: 5, to: 4, why: 'w', expected: 'e', status: 'pending' };

describe('signalChain', () => {
  it('lists trim, HPF, gate, PEQ, comp, sends and Main from real /node values with their ages', () => {
    const rows = signalChain(CH, DETAIL, SURFACES, {}, 1, NOW);
    expect(rows.map((r) => [r.name, r.value, r.age, r.state])).toEqual([
      ['Trim', '0.0 dB', 'read 3 s ago', 'ok'],
      ['HPF', '178 Hz · 24 dB/oct', 'read 3 s ago', 'ok'],
      ['Gate', 'GATE · thr -80.0 dB · range 60 dB', 'read 3 s ago', 'ok'],
      ['PEQ', '328.1 -6.3 · 1k09 +2.0', 'read 4 s ago', 'ok'],
      ['Comp', '5.0:1 · thr -23.0 dB', 'live', 'live'],
      ['Sends', 'Sends to: IEM1 · read 20 s ago', '', 'ok'],
      ['Main', 'Main LR · -4.3 dB', 'read 7 s ago', 'ok'],
    ]);
  });

  it('shows off states and inverted polarity', () => {
    const detail: ConsoleStripDetailDto = {
      ...DETAIL,
      preamp: { value: { trim: 2, invert: true, hpf: { on: false, slope: 12, freq: 80 } }, readAt: NOW },
      gate: { value: { ...DETAIL.gate!.value, on: false }, readAt: NOW },
      eq: { value: { on: false, bands: [] }, readAt: NOW },
    };
    const surfaces: ConsoleSurfacesDto = { ...SURFACES, main: { ...SURFACES.main, mix: { value: { on: false, faderDb: 0 }, readAt: NOW } } };
    const ch = { ...CH, dynamics: { ...CH.dynamics, on: false } };
    const rows = signalChain(ch, detail, surfaces, {}, 1, NOW);
    expect(rows.map((r) => [r.value, r.state])).toEqual([
      ['+2.0 dB · polarity inverted', 'ok'],
      ['Off', 'off'],
      ['Off', 'off'],
      ['Off', 'off'],
      ['Off', 'off'],
      ['Sends to: IEM1 · read 20 s ago', 'ok'],
      ['Main LR · off', 'off'],
    ]);
  });

  it('marks every value the slow tier has not read yet', () => {
    const rows = signalChain(undefined, undefined, null, {}, 3, NOW);
    expect(rows.every((r) => r.state === 'unread')).toBe(true);
    expect(rows.filter((r) => r.value === NOT_READ_YET)).toHaveLength(6);
  });

  it('adds a dashed proposed row only for a real pending move on this channel', () => {
    const rows = signalChain(CH, DETAIL, SURFACES, { [MOVE.key]: MOVE }, 1, NOW);
    expect(rows.find((r) => r.state === 'proposed')).toMatchObject({ value: 'Comp ratio 5.0:1 → 4.0:1', age: 'proposed' });
    expect(signalChain(CH, DETAIL, SURFACES, { [MOVE.key]: MOVE }, 2, NOW).some((r) => r.state === 'proposed')).toBe(false);
    const done = { ...MOVE, status: 'changed-on-desk' as const };
    expect(signalChain(CH, DETAIL, SURFACES, { [MOVE.key]: done }, 1, NOW).some((r) => r.state === 'proposed')).toBe(false);
  });
});

describe('spectrum well', () => {
  const freqs = [20, 200, 2000, 20000];

  it('draws the room RTA from real Measurement points on a log axis, skipping non-finite points', () => {
    const path = rtaPath({ freqs, db: [-40, -30, -Infinity, -50] });
    expect(path.startsWith('M0.0 ')).toBe(true);
    expect(path).toContain(`L${RTA_WIDTH.toFixed(1)} `);
    expect(path.split(' L')).toHaveLength(3);
  });

  it('draws nothing from fewer than two finite points', () => {
    expect(rtaPath({ freqs, db: [-40, NaN, NaN, NaN] })).toBe('');
  });

  it('labels the room RTA as the room, and marks a detected ring', () => {
    const well = spectrumWell({ freqs, db: [-40, -30, -20, -50] }, { freq: 2000, label: 'Ring near 2.0 kHz' });
    expect(well).toMatchObject({ kind: 'room', label: ROOM_RTA_LABEL, marker: { label: 'Ring near 2.0 kHz' } });
    expect(well.kind === 'room' && well.marker?.x).toBeCloseTo(RTA_WIDTH * 2 / 3, 5);
    expect(spectrumWell({ freqs, db: [-40, -30, -20, -50] }, null)).toMatchObject({ kind: 'room', marker: null });
  });

  it('shows the unavailable placard and no curve when the room mic is not listening', () => {
    expect(spectrumWell(null, null)).toEqual({ kind: 'unavailable', label: CHANNEL_SPECTRUM_UNAVAILABLE });
    expect(spectrumWell({ freqs, db: [NaN, NaN, NaN, NaN] }, null).kind).toBe('unavailable');
  });
});

describe('inspectorView', () => {
  it('assembles scribble, chain, proposed count and the unavailable masking and share placards', () => {
    const view = inspectorView({ index: 1, channels: [CH], stripDetail: [DETAIL], surfaces: SURFACES, moves: { [MOVE.key]: MOVE }, room: null, ring: null, now: NOW });
    expect(view.scribble.name).toBe('Lead Vox');
    expect(view.proposedCount).toBe(1);
    expect(view.spectrum.kind).toBe('unavailable');
    expect(view.masking).toBe(MASKING_UNAVAILABLE);
    expect(view.share).toBe(SHARE_OF_MAIN_UNAVAILABLE);
  });
});
