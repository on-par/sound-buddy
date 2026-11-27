// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { findSpectralPeaks } from '@sound-buddy/audio-engine/dist/analyze/spectral.js';
import type { ConsoleChannelStateDto } from '../../../electron/ipc/api';
import { issueKey, type MixerIssue } from './attention';
import type { RoomCurve } from './inspector';
import { channelLabel } from './view-model';

export const ROOM_RING_MIN_PROMINENCE_DB = 10;
export const ROOM_RING_SUSTAIN_MS = 3000;
export const ROOM_RING_SAME_PEAK_OCTAVES = 1 / 6;
export const OPEN_CHANNEL_FLOOR_DB = -60;
export const MAX_RING_CANDIDATES = 4;
const HZ_PER_KHZ = 1000;
const KHZ_DECIMALS = 1;

export interface RoomRingState {
  freq: number | null;
  prominence: number;
  since: number | null;
}

export const NO_ROOM_RING: RoomRingState = Object.freeze({ freq: null, prominence: 0, since: null });

export function formatFreq(hz: number): string {
  return hz >= HZ_PER_KHZ ? `${(hz / HZ_PER_KHZ).toFixed(KHZ_DECIMALS)} kHz` : `${Math.round(hz)} Hz`;
}

export function trackRoomRing(state: RoomRingState, room: RoomCurve | null, now: number): RoomRingState {
  if (!room) return NO_ROOM_RING;
  const [peak] = findSpectralPeaks({ freqs: [...room.freqs], db: [...room.db] }, { minProminenceDb: ROOM_RING_MIN_PROMINENCE_DB });
  if (!peak) return NO_ROOM_RING;
  const same = state.freq !== null && Math.abs(Math.log2(peak.freq / state.freq)) <= ROOM_RING_SAME_PEAK_OCTAVES;
  return { freq: peak.freq, prominence: peak.prominence, since: same && state.since !== null ? state.since : now };
}

export function roomRingIssue(state: RoomRingState, now: number): Omit<MixerIssue, 'activeSince'> | null {
  if (state.freq === null || state.since === null || now - state.since < ROOM_RING_SUSTAIN_MS) return null;
  return {
    key: issueKey('feedback-risk', null),
    kind: 'feedback-risk',
    channel: null,
    severity: 'issue',
    magnitude: state.prominence,
    diagnosis: `Room ring near ${formatFreq(state.freq)}`,
  };
}

export function ringCandidates(channels: readonly ConsoleChannelStateDto[], watched: number | null): string[] {
  const open = channels.filter((c) => c.on && c.faderDb > OPEN_CHANNEL_FLOOR_DB);
  const ordered = [...open.filter((c) => c.index === watched), ...open.filter((c) => c.index !== watched)];
  return ordered.slice(0, MAX_RING_CANDIDATES).map((c) => channelLabel(channels, c.index));
}
