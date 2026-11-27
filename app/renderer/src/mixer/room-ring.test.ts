// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  trackRoomRing,
  roomRingIssue,
  ringCandidates,
  formatFreq,
  NO_ROOM_RING,
  ROOM_RING_SUSTAIN_MS,
} from './room-ring';
import { selectAttention } from './attention';
import { ANALYZER_GRID_FREQS } from '../live-capture-panel';
import type { ConsoleChannelStateDto } from '../../../electron/ipc/api';

const T0 = 10_000;

function curveWithPeak(atHz: number | null, heightDb = 20): { freqs: number[]; db: number[] } {
  const peakIdx = atHz === null ? -1 : ANALYZER_GRID_FREQS.reduce((best, f, i) => (Math.abs(Math.log(f / atHz)) < Math.abs(Math.log(ANALYZER_GRID_FREQS[best] / atHz)) ? i : best), 0);
  return { freqs: ANALYZER_GRID_FREQS, db: ANALYZER_GRID_FREQS.map((_, i) => -50 + (i === peakIdx ? heightDb : 0)) };
}

function ch(index: number, on: boolean, faderDb: number): ConsoleChannelStateDto {
  return { index, name: `Mic ${index}`, faderDb, on, icon: 1, color: { base: null, inverted: false }, dynamics: { on: false, mode: 'COMP', thr: 0, ratio: 3, knee: 1, mgain: 0 } };
}

describe('room ring detection from the Measurement spectrum', () => {
  it('yields one room-level feedback card for a sustained narrow peak, never attributed to a channel', () => {
    let state = trackRoomRing(NO_ROOM_RING, curveWithPeak(2500), T0);
    expect(roomRingIssue(state, T0)).toBeNull();
    state = trackRoomRing(state, curveWithPeak(2500), T0 + ROOM_RING_SUSTAIN_MS);
    const issue = roomRingIssue(state, T0 + ROOM_RING_SUSTAIN_MS);
    expect(issue).toMatchObject({ key: 'feedback-risk:room', kind: 'feedback-risk', channel: null, severity: 'issue' });
    expect(issue!.diagnosis).toMatch(/^Room ring near 2\.\d kHz$/);
    expect(issue!.magnitude).toBeGreaterThanOrEqual(10);
  });

  it('passes Sermon Quiet while every other kind is held', () => {
    let state = trackRoomRing(NO_ROOM_RING, curveWithPeak(2500), T0);
    state = trackRoomRing(state, curveWithPeak(2500), T0 + ROOM_RING_SUSTAIN_MS);
    const ring = { ...roomRingIssue(state, T0 + ROOM_RING_SUSTAIN_MS)!, activeSince: T0 };
    const clip = { key: 'clipping:1', kind: 'clipping' as const, channel: 1, severity: 'issue' as const, magnitude: 3, activeSince: T0, diagnosis: 'c' };
    const view = selectAttention({ issues: [ring, clip], now: T0 + ROOM_RING_SUSTAIN_MS, sermonQuiet: true });
    expect(view.visible.map((i) => i.key)).toEqual(['feedback-risk:room']);
    expect(view.held.map((i) => i.key)).toEqual(['clipping:1']);
  });

  it('restarts the sustain clock when the peak moves to a different frequency', () => {
    let state = trackRoomRing(NO_ROOM_RING, curveWithPeak(2500), T0);
    state = trackRoomRing(state, curveWithPeak(400), T0 + ROOM_RING_SUSTAIN_MS);
    expect(state.since).toBe(T0 + ROOM_RING_SUSTAIN_MS);
    expect(roomRingIssue(state, T0 + ROOM_RING_SUSTAIN_MS)).toBeNull();
  });

  it('clears when the peak is not prominent enough, or when there is no spectrum at all', () => {
    const state = trackRoomRing(NO_ROOM_RING, curveWithPeak(2500), T0);
    expect(trackRoomRing(state, curveWithPeak(2500, 4), T0 + 100)).toEqual(NO_ROOM_RING);
    expect(trackRoomRing(state, curveWithPeak(null), T0 + 100)).toEqual(NO_ROOM_RING);
    expect(trackRoomRing(state, null, T0 + 100)).toEqual(NO_ROOM_RING);
    expect(roomRingIssue(NO_ROOM_RING, T0)).toBeNull();
  });
});

describe('ringCandidates', () => {
  it('lists open channels only, watched mic first, capped', () => {
    const channels = [ch(1, true, -10), ch(2, false, 0), ch(3, true, -80), ch(4, true, 0), ch(5, true, -5), ch(6, true, -1), ch(7, true, -2)];
    expect(ringCandidates(channels, 5)).toEqual(['05 Mic 5', '01 Mic 1', '04 Mic 4', '06 Mic 6']);
    expect(ringCandidates(channels, null)).toEqual(['01 Mic 1', '04 Mic 4', '05 Mic 5', '06 Mic 6']);
  });
});

describe('formatFreq', () => {
  it('formats Hz and kHz', () => {
    expect([formatFreq(800.4), formatFreq(2500)]).toEqual(['800 Hz', '2.5 kHz']);
  });
});
