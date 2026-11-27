// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type {
  ConsoleAgedDto,
  ConsoleChannelStateDto,
  ConsoleStripDetailDto,
  ConsoleSurfacesDto,
} from '../../../electron/ipc/api';
import { moveParamLabel, type ProposedMoves } from './proposed-moves';
import { compLabel, formatDb, formatReadAge, scribbleView, sendsLabel, type ScribbleView } from './view-model';

export const CHANNEL_SPECTRUM_UNAVAILABLE = 'Channel spectrum unavailable — board USB is not a 32-track input';
export const ROOM_RTA_LABEL = 'Room mic RTA — the whole room, not this channel';
export const MASKING_UNAVAILABLE = 'Masking unavailable — it needs a spectrum per channel, which this setup does not have';
export const SHARE_OF_MAIN_UNAVAILABLE = 'Share of Main LR unavailable — the console sends no per-channel post-fader meter';
export const NOT_READ_YET = 'Not read yet';
export const RTA_WIDTH = 600;
export const RTA_HEIGHT = 160;
const RTA_LOW_HZ = 20;
const RTA_HIGH_HZ = 20000;
const RTA_PAD_DB = 6;
const GAIN_DECIMALS = 1;
const PATH_DECIMALS = 1;

export type ChainState = 'ok' | 'off' | 'unread' | 'live' | 'proposed';

export interface ChainRow {
  key: string;
  name: string;
  value: string;
  age: string;
  state: ChainState;
}

export interface RoomCurve {
  freqs: readonly number[];
  db: readonly number[];
}

export type SpectrumWell =
  | { kind: 'room'; label: string; path: string; marker: { x: number; label: string } | null }
  | { kind: 'unavailable'; label: string };

export interface InspectorView {
  channel: number;
  scribble: ScribbleView;
  chain: ChainRow[];
  proposedCount: number;
  spectrum: SpectrumWell;
  masking: string;
  share: string;
}

function agedRow<T>(
  key: string,
  name: string,
  aged: ConsoleAgedDto<T> | null | undefined,
  now: number,
  describe: (v: T) => { value: string; on: boolean }
): ChainRow {
  if (!aged) return { key, name, value: NOT_READ_YET, age: '', state: 'unread' };
  const { value, on } = describe(aged.value);
  return { key, name, value, age: formatReadAge(aged.readAt, now), state: on ? 'ok' : 'off' };
}

function signedGain(gain: number): string {
  return `${gain > 0 ? '+' : ''}${gain.toFixed(GAIN_DECIMALS)}`;
}

export function signalChain(
  channel: ConsoleChannelStateDto | undefined,
  detail: ConsoleStripDetailDto | undefined,
  surfaces: ConsoleSurfacesDto | null,
  moves: ProposedMoves,
  index: number,
  now: number
): ChainRow[] {
  const rows: ChainRow[] = [
    agedRow('trim', 'Trim', detail?.preamp, now, (p) => ({ value: `${formatDb(p.trim)}${p.invert ? ' · polarity inverted' : ''}`, on: true })),
    agedRow('hpf', 'HPF', detail?.preamp, now, (p) => ({
      value: p.hpf.on ? `${p.hpf.freq} Hz · ${p.hpf.slope} dB/oct` : 'Off',
      on: p.hpf.on,
    })),
    agedRow('gate', 'Gate', detail?.gate, now, (g) => ({
      value: g.on ? `${g.mode} · thr ${formatDb(g.thr)} · range ${g.range} dB` : 'Off',
      on: g.on,
    })),
    agedRow('peq', 'PEQ', detail?.eq, now, (e) => ({
      value: e.on ? e.bands.map((b) => `${b.freq} ${signedGain(b.gain)}`).join(' · ') : 'Off',
      on: e.on,
    })),
    channel
      ? { key: 'comp', name: 'Comp', value: compLabel(channel), age: 'live', state: channel.dynamics.on ? 'live' : 'off' }
      : { key: 'comp', name: 'Comp', value: NOT_READ_YET, age: '', state: 'unread' },
  ];
  for (const move of Object.values(moves)) {
    if (move.channel !== index || move.status !== 'pending') continue;
    rows.push({ key: `proposed:${move.key}`, name: 'Comp', value: moveParamLabel(move), age: 'proposed', state: 'proposed' });
  }
  const sends = sendsLabel(detail, surfaces, now);
  rows.push({ key: 'sends', name: 'Sends', value: sends, age: '', state: detail?.sends ? 'ok' : 'unread' });
  rows.push(
    agedRow('main', 'Main', surfaces?.main.mix, now, (m) => ({ value: m.on ? `Main LR · ${formatDb(m.faderDb)}` : 'Main LR · off', on: m.on }))
  );
  return rows;
}

function xOf(freq: number): number {
  return (Math.log10(freq / RTA_LOW_HZ) / Math.log10(RTA_HIGH_HZ / RTA_LOW_HZ)) * RTA_WIDTH;
}

export function rtaPath(curve: RoomCurve): string {
  const points = curve.freqs.flatMap((f, i) => (Number.isFinite(curve.db[i]) ? [[f, curve.db[i]] as const] : []));
  if (points.length < 2) return '';
  const values = points.map(([, d]) => d);
  const hi = Math.max(...values) + RTA_PAD_DB;
  const lo = Math.min(...values) - RTA_PAD_DB;
  return points
    .map(([f, d], i) => {
      const x = xOf(f).toFixed(PATH_DECIMALS);
      const y = (((hi - d) / (hi - lo)) * RTA_HEIGHT).toFixed(PATH_DECIMALS);
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

export function spectrumWell(room: RoomCurve | null, ring: { freq: number; label: string } | null): SpectrumWell {
  const path = room ? rtaPath(room) : '';
  if (path === '') return { kind: 'unavailable', label: CHANNEL_SPECTRUM_UNAVAILABLE };
  return {
    kind: 'room',
    label: ROOM_RTA_LABEL,
    path,
    marker: ring ? { x: xOf(ring.freq), label: ring.label } : null,
  };
}

export function inspectorView(args: {
  index: number;
  channels: readonly ConsoleChannelStateDto[];
  stripDetail: readonly ConsoleStripDetailDto[];
  surfaces: ConsoleSurfacesDto | null;
  moves: ProposedMoves;
  room: RoomCurve | null;
  ring: { freq: number; label: string } | null;
  now: number;
}): InspectorView {
  const channel = args.channels.find((c) => c.index === args.index);
  const detail = args.stripDetail.find((d) => d.index === args.index);
  const chain = signalChain(channel, detail, args.surfaces, args.moves, args.index, args.now);
  return {
    channel: args.index,
    scribble: scribbleView(channel, args.index),
    chain,
    proposedCount: chain.filter((r) => r.state === 'proposed').length,
    spectrum: spectrumWell(args.room, args.ring),
    masking: MASKING_UNAVAILABLE,
    share: SHARE_OF_MAIN_UNAVAILABLE,
  };
}
