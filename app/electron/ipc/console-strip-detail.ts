// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { loadConsoleModule } from '../console-loader';
import type {
  ConsoleAgedDto,
  ConsoleStripDetailDto,
  ConsoleSurfacesDto,
  ConsoleMixSurfaceDto,
  ConsoleSendDto,
} from './api';

const { parseChannelStrips, parseChannelSendLine, parseConsoleSurfaces } = loadConsoleModule();

export const MAX_NODE_QUERIES_PER_TICK = 150;
export const SLOW_DETAIL_CHANNELS_PER_TICK = 4;
export const SLOW_SENDS_CHANNELS_PER_TICK = 1;
export const SLOW_SURFACE_PATHS_PER_TICK = 5;
export const SEND_BUS_COUNT = 16;
export const SURFACE_BUS_COUNT = 16;
const EQ_BAND_COUNT = 4;
const INDEX_PAD = 2;

export interface SlowTierCursor {
  detail: number;
  sends: number;
  surface: number;
}

export const INITIAL_SLOW_TIER_CURSOR: SlowTierCursor = Object.freeze({ detail: 0, sends: 0, surface: 0 });

export type SlowTierRequest =
  | { kind: 'detail'; channel: number; paths: string[] }
  | { kind: 'sends'; channel: number; paths: string[] }
  | { kind: 'surface'; path: string };

function pad(n: number): string {
  return String(n).padStart(INDEX_PAD, '0');
}

export function stripDetailPaths(channel: number): string[] {
  const base = `/ch/${pad(channel)}`;
  const bands = Array.from({ length: EQ_BAND_COUNT }, (_, i) => `${base}/eq/${i + 1}`);
  return [`${base}/preamp`, `${base}/gate`, `${base}/eq`, ...bands];
}

export function stripSendPaths(channel: number): string[] {
  return Array.from({ length: SEND_BUS_COUNT }, (_, i) => `/ch/${pad(channel)}/mix/${pad(i + 1)}`);
}

export function surfacePaths(): string[] {
  const buses = Array.from({ length: SURFACE_BUS_COUNT }, (_, i) => [`/bus/${pad(i + 1)}/config`, `/bus/${pad(i + 1)}/mix`]).flat();
  return [...buses, '/main/st/config', '/main/st/mix'];
}

const SURFACE_PATHS = surfacePaths();

export function planSlowTier(
  cursor: SlowTierCursor,
  channelCount: number
): { requests: SlowTierRequest[]; next: SlowTierCursor; queryCount: number } {
  const requests: SlowTierRequest[] = [];
  const detailCount = Math.min(SLOW_DETAIL_CHANNELS_PER_TICK, channelCount);
  for (let i = 0; i < detailCount; i++) {
    const channel = ((cursor.detail + i) % channelCount) + 1;
    requests.push({ kind: 'detail', channel, paths: stripDetailPaths(channel) });
  }
  const sendsCount = Math.min(SLOW_SENDS_CHANNELS_PER_TICK, channelCount);
  for (let i = 0; i < sendsCount; i++) {
    const channel = ((cursor.sends + i) % channelCount) + 1;
    requests.push({ kind: 'sends', channel, paths: stripSendPaths(channel) });
  }
  for (let i = 0; i < SLOW_SURFACE_PATHS_PER_TICK; i++) {
    requests.push({ kind: 'surface', path: SURFACE_PATHS[(cursor.surface + i) % SURFACE_PATHS.length] });
  }
  const queryCount = requests.reduce((n, r) => n + (r.kind === 'surface' ? 1 : r.paths.length), 0);
  return {
    requests,
    queryCount,
    next: {
      detail: (cursor.detail + detailCount) % channelCount,
      sends: (cursor.sends + sendsCount) % channelCount,
      surface: (cursor.surface + SLOW_SURFACE_PATHS_PER_TICK) % SURFACE_PATHS.length,
    },
  };
}

export function emptyStripDetail(index: number): ConsoleStripDetailDto {
  return { index, preamp: null, gate: null, eq: null, sends: null };
}

function emptySurface(kind: 'bus' | 'main', index: number | null): ConsoleMixSurfaceDto {
  return { kind, index, name: null, mix: null };
}

export function emptySurfaces(): ConsoleSurfacesDto {
  return {
    buses: Array.from({ length: SURFACE_BUS_COUNT }, (_, i) => emptySurface('bus', i + 1)),
    main: emptySurface('main', null),
  };
}

function aged<T>(value: T, readAt: number): ConsoleAgedDto<T> {
  return { value, readAt };
}

function singleStrip(line: string | null) {
  if (line === null) return null;
  const strips = parseChannelStrips(line);
  return strips.length === 1 ? strips[0] : null;
}

export function applyDetailLines(
  detail: ConsoleStripDetailDto,
  lines: Array<string | null>,
  readAt: number
): ConsoleStripDetailDto {
  const [preampLine, gateLine, ...eqLines] = lines;
  const preamp = singleStrip(preampLine);
  const gate = singleStrip(gateLine);
  const eqStrips = eqLines.map(singleStrip);
  const eqComplete = eqLines.length === EQ_BAND_COUNT + 1 && eqStrips.every((s) => s !== null);
  const eqStrip = eqComplete ? parseChannelStrips(eqLines.join('\n'))[0] : null;
  return {
    ...detail,
    preamp: preamp ? aged(preamp.preamp, readAt) : detail.preamp,
    gate: gate ? aged(gate.gate, readAt) : detail.gate,
    eq: eqStrip ? aged(eqStrip.eq, readAt) : detail.eq,
  };
}

export function applySendLines(
  detail: ConsoleStripDetailDto,
  lines: Array<string | null>,
  readAt: number
): ConsoleStripDetailDto {
  const sends: ConsoleSendDto[] = [];
  for (const line of lines) {
    const send = line === null ? null : parseChannelSendLine(line);
    if (!send || send.channel !== detail.index) return detail;
    sends.push({ bus: send.bus, on: send.on, level: send.level });
  }
  return sends.length === SEND_BUS_COUNT ? { ...detail, sends: aged(sends, readAt) } : detail;
}

const SURFACE_PATH_RE = /^\/(bus|main)\/(\d+|st)\/(config|mix)$/;

export function applySurfaceLine(
  surfaces: ConsoleSurfacesDto,
  path: string,
  line: string | null,
  readAt: number
): ConsoleSurfacesDto {
  const m = SURFACE_PATH_RE.exec(path);
  if (!m || line === null) return surfaces;
  const parsed = parseConsoleSurfaces(line);
  const strip = m[1] === 'bus' ? parsed.buses[0] : parsed.mains[0];
  if (!strip) return surfaces;
  const patch: Partial<ConsoleMixSurfaceDto> =
    m[3] === 'config' ? { name: aged(strip.name, readAt) } : { mix: aged({ on: strip.on, faderDb: strip.fader }, readAt) };
  if (m[1] === 'main') return { ...surfaces, main: { ...surfaces.main, ...patch } };
  const index = parseInt(m[2], 10);
  if (strip.index !== index) return surfaces;
  return { ...surfaces, buses: surfaces.buses.map((b) => (b.index === index ? { ...b, ...patch } : b)) };
}
