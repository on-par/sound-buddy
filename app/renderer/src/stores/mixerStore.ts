// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { ConsoleChannelStateDto, ConsoleLinkStateDto } from '../../../electron/ipc/api';
import { dismissIssue, pruneDismissals, type MixerDismissals, type MixerIssue } from '../mixer/attention';
import { EMPTY_RULE_HISTORY, grDbFromMeters, ingestMeterFrame, ruleIssues, trackActive, type RuleHistory } from '../mixer/rules';
import { appendFaderSamples, type FaderHistory } from '../mixer/view-model';
import { reconcileMoves, type ProposedMoves } from '../mixer/proposed-moves';
import { useConsoleStore, type ConsoleLiveStateStatus } from './consoleStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { ANALYZER_GRID_FREQS } from '../live-capture-panel';
import type { RoomCurve } from '../mixer/inspector';
import { NO_ROOM_RING, roomRingIssue, trackRoomRing, type RoomRingState } from '../mixer/room-ring';

export const ROOM_SAMPLE_MS = 500;

export interface MixerRoomInput {
  secondaryMeasurement: { status: string };
  lastMeasurementChannels: ReadonlyArray<{ curve?: number[] }> | null;
}

export type MixerViewFilter = 'attention' | 'all' | 'buses';

export interface MixerConsoleInput {
  liveChannels: readonly ConsoleChannelStateDto[];
  liveChannelsReadAt: number | null;
  liveMeters: readonly number[];
  liveDynamicsGainReduction: readonly number[];
  link: ConsoleLinkStateDto;
  liveStateStatus: ConsoleLiveStateStatus;
}

export interface MixerState {
  view: MixerViewFilter;
  inspected: number | null;
  sermonQuiet: boolean;
  watched: number | null;
  dismissals: MixerDismissals;
  history: RuleHistory;
  faderHistory: FaderHistory;
  issues: MixerIssue[];
  frozenIssues: MixerIssue[] | null;
  frozenAt: number | null;
  lastMeters: readonly number[] | null;
  lastChannelsReadAt: number | null;
  moves: ProposedMoves;
  dismissedMoves: string[];
  roomCurve: RoomCurve | null;
  roomCurveAt: number | null;
  ring: RoomRingState;
  lastChannels: readonly ConsoleChannelStateDto[];
  metersDegraded: boolean;
  ingestRoom(curve: readonly number[] | null, now: number): void;
  ingestConsole(input: MixerConsoleInput, now: number): void;
  showView(view: MixerViewFilter): void;
  inspectChannel(channel: number | null): void;
  toggleSermonQuiet(): void;
  watchChannel(channel: number | null): void;
  dismissCard(key: string, now: number): void;
  dismissMove(key: string): void;
}

export const INITIAL_MIXER_STATE = {
  view: 'attention' as MixerViewFilter,
  inspected: null as number | null,
  sermonQuiet: false,
  watched: null as number | null,
  dismissals: {} as MixerDismissals,
  history: EMPTY_RULE_HISTORY,
  faderHistory: {} as FaderHistory,
  issues: [] as MixerIssue[],
  frozenIssues: null as MixerIssue[] | null,
  frozenAt: null as number | null,
  lastMeters: null as readonly number[] | null,
  lastChannelsReadAt: null as number | null,
  moves: {} as ProposedMoves,
  dismissedMoves: [] as string[],
  roomCurve: null as RoomCurve | null,
  roomCurveAt: null as number | null,
  ring: NO_ROOM_RING,
  lastChannels: [] as readonly ConsoleChannelStateDto[],
  metersDegraded: false,
};

const WATCH_RUNNING: ReadonlySet<ConsoleLiveStateStatus> = new Set(['starting', 'watching']);

export function watchEnded(input: Pick<MixerConsoleInput, 'liveStateStatus' | 'liveChannels'>): boolean {
  return !WATCH_RUNNING.has(input.liveStateStatus) && input.liveChannels.length === 0;
}

function recompute(s: MixerState, history: RuleHistory, ring: RoomRingState, now: number) {
  const ringIssue = roomRingIssue(ring, now);
  const raw = [...(s.metersDegraded ? [] : ruleIssues(history, now)), ...(ringIssue ? [ringIssue] : [])];
  const tracked = trackActive(history, raw, now);
  return {
    history: tracked.history,
    issues: tracked.issues,
    moves: reconcileMoves(s.moves, tracked.issues, s.lastChannels, s.dismissedMoves),
  };
}

export function createMixerStore(): UseBoundStore<StoreApi<MixerState>> {
  return create<MixerState>()((set, get) => ({
    ...INITIAL_MIXER_STATE,

    ingestConsole(input, now) {
      const s = get();
      if (watchEnded(input)) {
        const cleared = { ...s, moves: {}, lastChannels: [], metersDegraded: false };
        set({
          ...recompute(cleared, EMPTY_RULE_HISTORY, s.ring, now),
          lastChannels: [],
          metersDegraded: false,
          faderHistory: {},
          lastMeters: null,
          lastChannelsReadAt: null,
          frozenIssues: null,
          frozenAt: null,
        });
        return;
      }
      if (input.link.status === 'offline') {
        if (s.frozenIssues === null) set({ frozenIssues: s.issues, frozenAt: now });
        return;
      }
      const freshMeters = !input.link.metersDegraded && input.liveMeters !== s.lastMeters;
      const history = freshMeters
        ? ingestMeterFrame(s.history, input.liveMeters, grDbFromMeters(input.liveDynamicsGainReduction), now)
        : s.history;
      const freshChannels = input.liveChannelsReadAt !== null && input.liveChannelsReadAt !== s.lastChannelsReadAt;
      const faderHistory = freshChannels
        ? appendFaderSamples(s.faderHistory, input.liveChannels, input.liveChannelsReadAt as number)
        : s.faderHistory;
      const next = { ...s, lastChannels: input.liveChannels, metersDegraded: input.link.metersDegraded };
      set({
        ...recompute(next, history, s.ring, now),
        lastChannels: input.liveChannels,
        metersDegraded: input.link.metersDegraded,
        faderHistory,
        lastMeters: input.liveMeters,
        lastChannelsReadAt: input.liveChannelsReadAt,
        dismissals: pruneDismissals(s.dismissals, now),
        frozenIssues: null,
        frozenAt: null,
      });
    },

    ingestRoom(curve, now) {
      const s = get();
      if (curve === null || curve.length !== ANALYZER_GRID_FREQS.length) {
        if (s.roomCurve !== null) set({ roomCurve: null, roomCurveAt: null, ring: NO_ROOM_RING, ...recompute(s, s.history, NO_ROOM_RING, now) });
        return;
      }
      if (s.roomCurveAt !== null && now - s.roomCurveAt < ROOM_SAMPLE_MS) return;
      const roomCurve = { freqs: ANALYZER_GRID_FREQS, db: curve };
      const ring = trackRoomRing(s.ring, roomCurve, now);
      set({ roomCurve, roomCurveAt: now, ring, ...recompute(s, s.history, ring, now) });
    },

    showView(view) {
      set({ view });
    },

    inspectChannel(channel) {
      set({ inspected: channel });
    },

    toggleSermonQuiet() {
      set({ sermonQuiet: !get().sermonQuiet });
    },

    watchChannel(channel) {
      set({ watched: channel });
    },

    dismissCard(key, now) {
      const issue = get().issues.find((i) => i.key === key);
      if (issue) set({ dismissals: dismissIssue(get().dismissals, issue, now) });
    },

    dismissMove(key) {
      const moves = Object.fromEntries(Object.entries(get().moves).filter(([k]) => k !== key));
      set({ moves, dismissedMoves: [...get().dismissedMoves, key] });
    },
  }));
}

export function bindMixerIngest(
  mixer: UseBoundStore<StoreApi<MixerState>>,
  source: { subscribe(listener: (state: MixerConsoleInput) => void): () => void },
  now: () => number
): () => void {
  return source.subscribe((state) => mixer.getState().ingestConsole(state, now()));
}

export function roomCurveOf(state: MixerRoomInput): readonly number[] | null {
  if (state.secondaryMeasurement.status !== 'active') return null;
  return state.lastMeasurementChannels?.[0]?.curve ?? null;
}

export function bindMixerRoom(
  mixer: UseBoundStore<StoreApi<MixerState>>,
  source: { subscribe(listener: (state: MixerRoomInput) => void): () => void },
  now: () => number
): () => void {
  return source.subscribe((state) => mixer.getState().ingestRoom(roomCurveOf(state), now()));
}

export const useMixerStore = createMixerStore();
bindMixerIngest(useMixerStore, useConsoleStore, Date.now);
bindMixerRoom(useMixerStore, useLiveCaptureStore, Date.now);
