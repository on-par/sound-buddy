// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type {
  ConsoleChannelColorBase,
  ConsoleChannelStateDto,
  ConsoleSendDto,
  ConsoleStripDetailDto,
  ConsoleSurfacesDto,
} from '../../../electron/ipc/api';
import type { AttentionView, MixerIssue, MixerIssueKind, MixerSeverity } from './attention';
import { formatDbfs, linearToDbfs, GR_UNAVAILABLE_LABEL, METERS_UNAVAILABLE_LABEL } from './rules';
import { adviceText, moveParamLabel, type ProposedMoves } from './proposed-moves';

export const SHARE_OF_MIX_UNAVAILABLE = 'Share of mix unavailable';
export const BUS_METERS_UNAVAILABLE = 'Bus meters unavailable';
export const MAIN_LUFS_UNAVAILABLE = 'Main LUFS unavailable';
export const SENDS_NOT_READ = 'Sends not read yet';
export const NO_ACTIVE_SENDS = 'No active sends';
export const FADER_TREND_WINDOW_MS = 120_000;
export const FADER_HISTORY_LIMIT = 180;
export const DOCK_BUS_LIMIT = 4;
const FADER_DECIMALS = 1;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MINUTES_PER_HOUR = 60;
const PERCENT = 100;
const METER_FLOOR_DBFS = -60;
const FADER_STEADY_EPSILON_DB = 0.05;
const TWO_DIGITS = 2;

const FADER_SCALE: ReadonlyArray<readonly [number, number]> = [
  [10, 100],
  [0, 75],
  [-10, 50],
  [-30, 25],
  [-60, 6],
];

export interface FaderSample {
  t: number;
  db: number;
}

export type FaderHistory = Readonly<Record<number, readonly FaderSample[]>>;

export interface ScribbleView {
  number: string;
  name: string;
  colorClass: string;
  inverted: boolean;
  icon: number | null;
}

export interface FactTile {
  label: string;
  value: string;
  tone: MixerSeverity | null;
}

export interface MeterSlot {
  available: boolean;
  percent: number;
  label: string;
}

export interface CardView {
  key: string;
  kind: MixerIssueKind;
  channel: number | null;
  scribble: ScribbleView | null;
  severity: MixerSeverity;
  pillLabel: string;
  age: string;
  diagnosis: string;
  fader: { label: string; percent: number } | null;
  level: MeterSlot;
  grLabel: string;
  facts: FactTile[];
  sends: string;
  share: string;
  candidates: string[];
  inspected: boolean;
}

export interface CardContext {
  channels: readonly ConsoleChannelStateDto[];
  meters: readonly number[];
  metersAvailable: boolean;
  stripDetail: readonly ConsoleStripDetailDto[];
  surfaces: ConsoleSurfacesDto | null;
  faderHistory: FaderHistory;
  clipPeaks: Readonly<Record<number, number>>;
  ring: { freqLabel: string; prominenceDb: number; candidates: string[] } | null;
  inspected: number | null;
  now: number;
}

const COLOR_CLASS: Readonly<Record<ConsoleChannelColorBase, string>> = {
  off: 'mx-c-off',
  red: 'mx-c-red',
  green: 'mx-c-green',
  yellow: 'mx-c-yellow',
  blue: 'mx-c-blue',
  magenta: 'mx-c-magenta',
  cyan: 'mx-c-cyan',
  white: 'mx-c-white',
};
const NEUTRAL_CLASS = 'mx-c-neutral';

const KIND_LABEL: Readonly<Record<MixerIssueKind, string>> = {
  clipping: 'Clipping',
  'over-compression': 'Over-compression',
  'feedback-risk': 'Feedback risk',
};

const SEVERITY_LABEL: Readonly<Record<MixerSeverity, string>> = { issue: 'Issue', check: 'Check', info: 'Info' };

export function severityLabel(severity: MixerSeverity): string {
  return SEVERITY_LABEL[severity];
}

export function kindLabel(kind: MixerIssueKind): string {
  return KIND_LABEL[kind];
}

export function channelNumber(index: number): string {
  return String(index).padStart(TWO_DIGITS, '0');
}

export function channelName(channel: Pick<ConsoleChannelStateDto, 'index' | 'name'> | undefined, index: number): string {
  const name = channel?.name.trim() ?? '';
  return name === '' ? `Ch ${index}` : name;
}

export function scribbleView(channel: ConsoleChannelStateDto | undefined, index: number): ScribbleView {
  const base = channel?.color.base ?? null;
  return {
    number: channelNumber(index),
    name: channelName(channel, index),
    colorClass: base === null ? NEUTRAL_CLASS : COLOR_CLASS[base],
    inverted: channel?.color.inverted ?? false,
    icon: channel?.icon ?? null,
  };
}

export function channelLabel(channels: readonly ConsoleChannelStateDto[], index: number): string {
  return `${channelNumber(index)} ${channelName(channels.find((c) => c.index === index), index)}`;
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '-∞ dB';
  return `${db > 0 ? '+' : ''}${db.toFixed(FADER_DECIMALS)} dB`;
}

export function faderPercent(db: number): number {
  if (!Number.isFinite(db)) return 0;
  if (db >= FADER_SCALE[0][0]) return FADER_SCALE[0][1];
  for (let i = 0; i < FADER_SCALE.length - 1; i++) {
    const [hiDb, hiPct] = FADER_SCALE[i];
    const [loDb, loPct] = FADER_SCALE[i + 1];
    if (db >= loDb) return loPct + ((db - loDb) / (hiDb - loDb)) * (hiPct - loPct);
  }
  const [floorDb, floorPct] = FADER_SCALE[FADER_SCALE.length - 1];
  return Math.max(0, floorPct * (1 - (floorDb - db) / -floorDb));
}

export function meterPercent(linear: number): number {
  const db = linearToDbfs(linear);
  if (db <= METER_FLOOR_DBFS) return 0;
  if (db >= 0) return PERCENT;
  return ((db - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS) * PERCENT;
}

export function meterSlot(meters: readonly number[], metersAvailable: boolean, index: number): MeterSlot {
  if (!metersAvailable) return { available: false, percent: 0, label: METERS_UNAVAILABLE_LABEL };
  const level = meters[index - 1] ?? 0;
  return { available: true, percent: meterPercent(level), label: formatDbfs(level) };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const seconds = total % SECONDS_PER_MINUTE;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const hours = Math.floor(total / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const ss = String(seconds).padStart(TWO_DIGITS, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(TWO_DIGITS, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

export function formatReadAge(readAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - readAt) / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) return `read ${seconds} s ago`;
  return `read ${Math.floor(seconds / SECONDS_PER_MINUTE)} min ago`;
}

export function appendFaderSamples(
  history: FaderHistory,
  channels: readonly ConsoleChannelStateDto[],
  readAt: number
): FaderHistory {
  const next: Record<number, readonly FaderSample[]> = { ...history };
  for (const ch of channels) {
    const prior = next[ch.index] ?? [];
    if (prior.length > 0 && prior[prior.length - 1].t === readAt) continue;
    next[ch.index] = [...prior, { t: readAt, db: ch.faderDb }].slice(-FADER_HISTORY_LIMIT);
  }
  return next;
}

export function faderTrend(samples: readonly FaderSample[] | undefined, now: number): string {
  if (!samples || samples.length < 2) return 'Collecting poll history';
  const recent = samples.filter((s) => now - s.t <= FADER_TREND_WINDOW_MS);
  const span = recent.length >= 2 ? recent : samples.slice(-2);
  const first = span[0];
  const last = span[span.length - 1];
  const elapsed = formatClock(last.t - first.t);
  if (!Number.isFinite(first.db) || !Number.isFinite(last.db)) {
    return first.db === last.db ? `Steady over ${elapsed}` : `${formatDb(first.db)} → ${formatDb(last.db)} in ${elapsed}`;
  }
  const delta = last.db - first.db;
  if (Math.abs(delta) < FADER_STEADY_EPSILON_DB) return `Steady over ${elapsed}`;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(FADER_DECIMALS)} dB in ${elapsed}`;
}

export function busName(surfaces: ConsoleSurfacesDto | null, bus: number): string {
  const name = surfaces?.buses.find((b) => b.index === bus)?.name?.value.trim() ?? '';
  return name === '' ? `Bus ${bus}` : name;
}

export function busLabel(surfaces: ConsoleSurfacesDto | null, bus: number): string {
  const name = busName(surfaces, bus);
  return name === `Bus ${bus}` ? name : `Bus ${bus} · ${name}`;
}

export function sendingBuses(sends: readonly ConsoleSendDto[]): number[] {
  return sends.filter((s) => s.on && Number.isFinite(s.level)).map((s) => s.bus);
}

export function activeSendBuses(detail: ConsoleStripDetailDto | undefined): number[] | null {
  if (!detail?.sends) return null;
  return sendingBuses(detail.sends.value);
}

export function sendsSummary(detail: ConsoleStripDetailDto | undefined, surfaces: ConsoleSurfacesDto | null): string {
  const buses = activeSendBuses(detail);
  if (buses === null) return SENDS_NOT_READ;
  if (buses.length === 0) return NO_ACTIVE_SENDS;
  const names = [...new Set(buses.map((b) => busName(surfaces, b)))];
  return `Sends to: ${names.join(', ')}`;
}

export function sendsLabel(
  detail: ConsoleStripDetailDto | undefined,
  surfaces: ConsoleSurfacesDto | null,
  now: number
): string {
  const summary = sendsSummary(detail, surfaces);
  return detail?.sends ? `${summary} · ${formatReadAge(detail.sends.readAt, now)}` : summary;
}

export function compLabel(channel: ConsoleChannelStateDto | undefined): string {
  if (!channel) return 'Not read yet';
  const d = channel.dynamics;
  if (!d.on) return 'Off';
  return `${d.ratio.toFixed(FADER_DECIMALS)}:1 · thr ${formatDb(d.thr)}`;
}

function cardFacts(issue: MixerIssue, ctx: CardContext, channel: ConsoleChannelStateDto | undefined): FactTile[] {
  const trend: FactTile = {
    label: 'Fader trend',
    value: faderTrend(issue.channel === null ? undefined : ctx.faderHistory[issue.channel], ctx.now),
    tone: null,
  };
  const comp: FactTile = { label: 'Comp', value: compLabel(channel), tone: null };
  if (issue.kind === 'clipping') {
    const peak = ctx.clipPeaks[Number(issue.channel)];
    return [{ label: 'Peak level', value: peak === undefined ? '—' : formatDbfs(peak), tone: 'issue' }, comp, trend];
  }
  if (issue.kind === 'over-compression') {
    return [{ label: 'Gain reduction', value: formatDb(-issue.magnitude), tone: 'check' }, comp, trend];
  }
  return [
    { label: 'Ring', value: ctx.ring?.freqLabel ?? '—', tone: 'issue' },
    { label: 'Stands out by', value: ctx.ring ? formatDb(ctx.ring.prominenceDb) : '—', tone: null },
    { label: 'Source', value: 'Room mic RTA', tone: null },
  ];
}

export function cardView(issue: MixerIssue, ctx: CardContext): CardView {
  const index = issue.channel;
  const channel = index === null ? undefined : ctx.channels.find((c) => c.index === index);
  const detail = index === null ? undefined : ctx.stripDetail.find((d) => d.index === index);
  return {
    key: issue.key,
    kind: issue.kind,
    channel: index,
    scribble: index === null ? null : scribbleView(channel, index),
    severity: issue.severity,
    pillLabel: `${severityLabel(issue.severity)} · ${kindLabel(issue.kind)}`,
    age: formatClock(ctx.now - issue.activeSince),
    diagnosis: issue.diagnosis,
    fader: channel ? { label: formatDb(channel.faderDb), percent: faderPercent(channel.faderDb) } : null,
    level: index === null ? { available: false, percent: 0, label: '' } : meterSlot(ctx.meters, ctx.metersAvailable, index),
    grLabel: GR_UNAVAILABLE_LABEL,
    facts: cardFacts(issue, ctx, channel),
    sends: index === null ? '' : sendsLabel(detail, ctx.surfaces, ctx.now),
    share: index === null ? '' : SHARE_OF_MIX_UNAVAILABLE,
    candidates: index === null ? (ctx.ring?.candidates ?? []) : [],
    inspected: index !== null && index === ctx.inspected,
  };
}

export interface QueuedPill {
  label: string;
  severity: MixerSeverity;
}

export function queuedPill(attention: AttentionView, channels: readonly ConsoleChannelStateDto[]): QueuedPill | null {
  const first = attention.queued[0];
  if (!first) return null;
  const who = first.channel === null ? 'Room' : channelLabel(channels, first.channel);
  return {
    label: `+${attention.queued.length} queued · ${who} (${severityLabel(first.severity)})`,
    severity: first.severity,
  };
}

export interface DockTile {
  channel: number;
  scribble: ScribbleView;
  queuedSeverity: MixerSeverity | null;
  level: MeterSlot;
  watched: boolean;
  dimmed: boolean;
}

export interface DockBus {
  index: number;
  name: string;
  label: string;
  fader: string;
  on: boolean;
  age: string;
}

export interface DockView {
  header: string;
  tiles: DockTile[];
  buses: DockBus[];
  busMeters: string;
  mainLufs: string;
}

export interface DockContext {
  channels: readonly ConsoleChannelStateDto[];
  meters: readonly number[];
  metersAvailable: boolean;
  surfaces: ConsoleSurfacesDto | null;
  watched: number | null;
  sermonQuiet: boolean;
  now: number;
}

export function readBuses(surfaces: ConsoleSurfacesDto | null, now: number): DockBus[] {
  if (!surfaces) return [];
  return surfaces.buses.flatMap((b) => {
    if (b.index === null || !b.name || !b.mix) return [];
    const oldest = Math.min(b.name.readAt, b.mix.readAt);
    return [{ index: b.index, name: busName(surfaces, b.index), label: busLabel(surfaces, b.index), fader: formatDb(b.mix.value.faderDb), on: b.mix.value.on, age: formatReadAge(oldest, now) }];
  });
}

function severityByChannel(issues: readonly MixerIssue[]): Map<number, MixerSeverity> {
  const map = new Map<number, MixerSeverity>();
  for (const q of issues) {
    if (q.channel !== null && !map.has(q.channel)) map.set(q.channel, q.severity);
  }
  return map;
}

function tileFor(ctx: DockContext, severity: Map<number, MixerSeverity>) {
  return (c: ConsoleChannelStateDto): DockTile => ({
    channel: c.index,
    scribble: scribbleView(c, c.index),
    queuedSeverity: severity.get(c.index) ?? null,
    level: meterSlot(ctx.meters, ctx.metersAvailable, c.index),
    watched: ctx.watched === c.index,
    dimmed: ctx.sermonQuiet && ctx.watched !== c.index,
  });
}

export function boardTiles(attention: AttentionView, ctx: DockContext): DockTile[] {
  const severity = severityByChannel([...attention.visible, ...attention.queued, ...attention.held]);
  return ctx.channels.map(tileFor(ctx, severity));
}

export function dockView(attention: AttentionView, ctx: DockContext): DockView {
  const shown = new Set(attention.visible.map((i) => i.channel));
  const queuedSeverity = severityByChannel(attention.queued);
  const tile = tileFor(ctx, queuedSeverity);
  const others = ctx.channels.filter((c) => !shown.has(c.index));
  const queuedTiles = others.filter((c) => queuedSeverity.has(c.index)).map(tile);
  const restTiles = others.filter((c) => !queuedSeverity.has(c.index)).map(tile);
  return {
    header: `${others.length} channels · ${queuedTiles.length} queued`,
    tiles: [...queuedTiles, ...restTiles],
    buses: readBuses(ctx.surfaces, ctx.now).slice(0, DOCK_BUS_LIMIT),
    busMeters: BUS_METERS_UNAVAILABLE,
    mainLufs: MAIN_LUFS_UNAVAILABLE,
  };
}

export interface RailAdvice {
  key: string;
  severity: MixerSeverity;
  text: string;
}

export interface RailMove {
  key: string;
  scribble: ScribbleView;
  label: string;
  position: string;
  param: string;
  why: string;
  expected: string;
  changedOnDesk: boolean;
}

export interface RailView {
  context: string;
  sermonLine: string | null;
  advice: RailAdvice[];
  moves: RailMove[];
  frozen: boolean;
}

export interface RailSources {
  model: string | null;
  offline?: boolean;
  channelsRead: boolean;
  metersAvailable: boolean;
  roomListening: boolean;
}

export function railContextLine(src: RailSources): string {
  const desk = src.model ?? 'console';
  const poll = src.offline ? `${desk} offline` : src.channelsRead ? `${desk} channel poll` : `${desk} channel poll (waiting for first read)`;
  const meters = src.metersAvailable ? 'input meters' : 'input meters unavailable';
  const parts = [
    poll,
    ...(src.offline ? [] : [meters]),
    src.roomListening ? 'room mic RTA' : 'room mic not listening',
  ];
  return `Reading: ${parts.join(' · ')}`;
}

export function railView(
  attention: AttentionView,
  moves: ProposedMoves,
  channels: readonly ConsoleChannelStateDto[],
  opts: { sources: RailSources; sermonQuiet: boolean; ringFreq: string | null }
): RailView {
  const advice = attention.visible.flatMap((issue) => {
    const who = issue.channel === null ? 'Room' : channelLabel(channels, issue.channel);
    const text = adviceText(issue, who, opts.ringFreq);
    return text === null ? [] : [{ key: issue.key, severity: issue.severity, text }];
  });
  const list = Object.values(moves).sort((a, b) => a.channel - b.channel || a.key.localeCompare(b.key));
  return {
    context: railContextLine(opts.sources),
    sermonLine: opts.sermonQuiet ? `Only feedback risk will interrupt · ${attention.held.length} held` : null,
    advice,
    moves: list.map((m, i) => ({
      key: m.key,
      scribble: scribbleView(channels.find((c) => c.index === m.channel), m.channel),
      label: kindLabel('over-compression'),
      position: `${i + 1} of ${list.length}`,
      param: moveParamLabel(m),
      why: m.why,
      expected: m.expected,
      changedOnDesk: m.status === 'changed-on-desk',
    })),
    frozen: attention.frozen,
  };
}

export const CALM_TITLE = 'No urgent issues detected';
export const CALM_BODY = 'These checks are running. A quiet board here does not mean every channel is clean.';

export type LinkChipState = 'connected' | 'connecting' | 'offline' | 'idle';

export interface ToolbarView {
  chipState: LinkChipState;
  chipText: string;
  showStart: boolean;
  showReconnect: boolean;
  counts: { attention: number; all: number; buses: number };
}

export function toolbarView(args: {
  model: string | null;
  liveStateStatus: 'idle' | 'starting' | 'watching' | 'error';
  link: { status: 'unknown' | 'online' | 'offline' };
  channelCount: number;
  attention: AttentionView;
  busesRead: number;
}): ToolbarView {
  const model = args.model ?? 'console';
  const watching = args.liveStateStatus === 'watching' || args.liveStateStatus === 'starting';
  let chipState: LinkChipState;
  let chipText: string;
  if (args.link.status === 'offline') {
    chipState = 'offline';
    chipText = `Offline: ${model}`;
  } else if (!watching) {
    chipState = 'idle';
    chipText = `Not watching: ${model}`;
  } else if (args.link.status === 'online' && args.channelCount > 0) {
    chipState = 'connected';
    chipText = `Connected: ${model} · ${args.channelCount} ch`;
  } else {
    chipState = 'connecting';
    chipText = `Connecting: ${model}`;
  }
  return {
    chipState,
    chipText,
    showStart: chipState === 'idle',
    showReconnect: chipState === 'offline',
    counts: {
      attention: args.attention.visible.length + args.attention.queued.length,
      all: args.channelCount,
      buses: args.busesRead,
    },
  };
}

export function calmChecks(args: { channelCount: number; metersAvailable: boolean; roomListening: boolean }): string[] {
  return [
    args.metersAvailable
      ? `Clipping: watching ${args.channelCount} inputs on the console meters`
      : 'Clipping: paused while console meters are unavailable',
    'Over-compression: off until the GR meter scale is established',
    args.roomListening ? 'Room ring: watching the room mic' : 'Room ring: off, the room mic is not listening',
  ];
}

export const SERMON_TITLE_LIVE = 'Sermon Quiet active — feedback watch only';
export const SERMON_TITLE_UNAVAILABLE = 'Sermon Quiet active — feedback watch unavailable — room mic is not listening';

export interface SermonBanner {
  live: boolean;
  title: string;
  body: string;
  held: string;
}

export function sermonBanner(args: { watchLive: boolean; watchedLabel: string | null; heldCount: number }): SermonBanner {
  const heldNote = 'Clipping alerts are held for later.';
  const watching = args.watchedLabel
    ? `Watching ${args.watchedLabel}; other strips are dimmed.`
    : 'Pick the mic to watch on the board below; the other strips dim.';
  return {
    live: args.watchLive,
    title: args.watchLive ? SERMON_TITLE_LIVE : SERMON_TITLE_UNAVAILABLE,
    body: args.watchLive
      ? `${watching} ${heldNote}`
      : `Start the room mic listen so Sound Buddy can watch the room for ring. ${watching} ${heldNote}`,
    held: `${args.heldCount} ${args.heldCount === 1 ? 'alert' : 'alerts'} held for later`,
  };
}

export interface LinkNotice {
  tone: 'issue' | 'check';
  text: string;
}

export function linkNotice(args: {
  link: { status: 'unknown' | 'online' | 'offline'; metersDegraded: boolean };
  frozenAt: number | null;
  now: number;
}): LinkNotice | null {
  if (args.link.status === 'offline') {
    const held = args.frozenAt === null ? '' : ` for ${formatClock(args.now - args.frozenAt)}`;
    return {
      tone: 'issue',
      text: `Console offline. Cards are frozen${held} and moves are disabled. Check the console is on this network, then press Reconnect.`,
    };
  }
  if (args.link.metersDegraded) {
    return {
      tone: 'check',
      text: `${METERS_UNAVAILABLE_LABEL}. Meter checks are paused; channel state is still being read from the console.`,
    };
  }
  return null;
}
