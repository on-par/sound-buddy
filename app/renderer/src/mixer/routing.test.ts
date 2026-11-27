// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { busRoutes, channelRanges } from './routing';
import type { ConsoleChannelStateDto, ConsoleStripDetailDto, ConsoleSurfacesDto } from '../../../electron/ipc/api';

const NOW = 60_000;

function ch(index: number, name: string): ConsoleChannelStateDto {
  return { index, name, faderDb: 0, on: true, icon: 1, color: { base: null, inverted: false }, dynamics: { on: false, mode: 'COMP', thr: 0, ratio: 3, knee: 1, mgain: 0 } };
}

const SURFACES: ConsoleSurfacesDto = {
  buses: [
    { kind: 'bus', index: 1, name: { value: 'IEM1', readAt: NOW - 5000 }, mix: { value: { on: true, faderDb: -3.4 }, readAt: NOW - 2000 } },
    { kind: 'bus', index: 2, name: null, mix: { value: { on: false, faderDb: -Infinity }, readAt: NOW - 1000 } },
    { kind: 'bus', index: 3, name: null, mix: null },
    { kind: 'bus', index: null, name: null, mix: null },
  ],
  main: { kind: 'main', index: null, name: null, mix: null },
};

const DETAIL: ConsoleStripDetailDto[] = [
  { index: 1, preamp: null, gate: null, eq: null, sends: { value: [{ bus: 1, on: true, level: -9.8 }, { bus: 2, on: true, level: -Infinity }], readAt: NOW - 1000 } },
  { index: 2, preamp: null, gate: null, eq: null, sends: { value: [{ bus: 1, on: true, level: 2.3 }, { bus: 3, on: false, level: 0 }], readAt: NOW - 1000 } },
  { index: 3, preamp: null, gate: null, eq: null, sends: null },
];

describe('busRoutes', () => {
  it('builds name, fader, on and the channels sending to each bus from parsed sends and surfaces', () => {
    const view = busRoutes(SURFACES, DETAIL, [ch(1, 'Lead Vox'), ch(2, 'Vox 1')], NOW);
    expect(view.buses).toEqual([
      { index: 1, name: 'IEM1', label: 'Bus 1 · IEM1', ranges: '2 channels · 01–02', read: true, fader: '-3.4 dB', on: true, age: 'read 5 s ago', routeAge: 'read 5 s ago', channels: ['01 Lead Vox', '02 Vox 1'] },
      { index: 2, name: 'Bus 2', label: 'Bus 2', ranges: '0 channels', read: false, fader: '-∞ dB', on: false, age: 'read 1 s ago', routeAge: '', channels: [] },
      { index: 3, name: 'Bus 3', label: 'Bus 3', ranges: '0 channels', read: false, fader: null, on: null, age: 'not read yet', routeAge: '', channels: [] },
    ]);
  });

  it('ages each routing row by the oldest send read behind it, and by the bus name when it is older', () => {
    const detail: ConsoleStripDetailDto[] = [
      { index: 1, preamp: null, gate: null, eq: null, sends: { value: [{ bus: 2, on: true, level: -5 }], readAt: NOW - 30_000 } },
      { index: 4, preamp: null, gate: null, eq: null, sends: { value: [{ bus: 2, on: true, level: -5 }, { bus: 1, on: true, level: 0 }], readAt: NOW - 3000 } },
    ];
    const view = busRoutes(SURFACES, detail, [], NOW);
    expect(view.buses.map((b) => [b.index, b.routeAge])).toEqual([[1, 'read 5 s ago'], [2, 'read 30 s ago'], [3, '']]);
  });

  it('counts how many channels have had their sends read', () => {
    const view = busRoutes(SURFACES, DETAIL, [], NOW);
    expect(view.sendsRead).toBe(2);
    expect(view.channelCount).toBe(3);
    expect(view.coverage).toBe('Sends read for 2 of 3 channels; the rest arrive on the slow poll.');
  });

  it('says all channels once every send has been read', () => {
    const all = DETAIL.slice(0, 2);
    expect(busRoutes(SURFACES, all, [], NOW).coverage).toBe('Sends read for all 2 channels');
  });

  it('compresses channel numbers into ranges', () => {
    expect(channelRanges([3, 1, 2, 5, 7, 8])).toBe('6 channels · 01–03, 05, 07–08');
    expect(channelRanges([9])).toBe('1 channel · 09');
    expect(channelRanges([])).toBe('0 channels');
  });

  it('is empty before any surfaces arrive', () => {
    expect(busRoutes(null, [], [], NOW).buses).toEqual([]);
  });
});
