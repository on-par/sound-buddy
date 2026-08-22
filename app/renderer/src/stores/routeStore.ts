// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { SoundcheckBus } from '../../../electron/ipc/api';

export interface TrackRouteState {
  inputChannels: number[];
  outputChannels: number[];
}

export interface RouteState {
  tracks: TrackRouteState[];
  savedBuses: SoundcheckBus[];
  masterMixdown: boolean;
}

export interface RouteStoreState {
  routesBySession: Record<string, RouteState>;
  ensureSession(sessionId: string, initial: RouteState): RouteState;
  getRouteState(sessionId: string): RouteState | null;
  updateTrackInput(sessionId: string, trackIndex: number, inputChannels: number[]): RouteState | null;
  updateTrackOutput(sessionId: string, trackIndex: number, outputChannels: number[]): RouteState | null;
  updateSavedBuses(sessionId: string, savedBuses: SoundcheckBus[]): RouteState | null;
  setMasterMixdown(sessionId: string, masterMixdown: boolean): RouteState | null;
  validateForDevice(sessionId: string, deviceChannelCount: number): RouteState | null;
}

const FIRST_DEVICE_CHANNEL = 0;
const FIRST_TRACK_INDEX = 0;

function cloneRouteState(state: RouteState): RouteState {
  return {
    tracks: state.tracks.map((track) => ({
      inputChannels: [...track.inputChannels],
      outputChannels: [...track.outputChannels],
    })),
    savedBuses: state.savedBuses.map((bus) => ({ ...bus })),
    masterMixdown: state.masterMixdown,
  };
}

// A session's routing is only compatible with the recorded track layout when
// both the number of tracks and each track's mono/stereo input width match.
// Output assignments are intentionally excluded: they are user edits that
// must survive re-opening the same session.
function hasSameTrackShape(existing: RouteState, initial: RouteState): boolean {
  return existing.tracks.length === initial.tracks.length
    && existing.tracks.every((track, index) => track.inputChannels.length === initial.tracks[index].inputChannels.length);
}

function isValidChannel(channel: number, deviceChannelCount: number): boolean {
  return Number.isInteger(channel)
    && channel >= FIRST_DEVICE_CHANNEL
    && channel < deviceChannelCount;
}

function isKnownDevice(deviceChannelCount: number): boolean {
  return Number.isFinite(deviceChannelCount) && deviceChannelCount > FIRST_DEVICE_CHANNEL;
}

function hasTrackAtIndex(state: RouteState, trackIndex: number): boolean {
  return Number.isInteger(trackIndex)
    && trackIndex >= FIRST_TRACK_INDEX
    && trackIndex < state.tracks.length;
}

export function validateRouteState(state: RouteState, deviceChannelCount: number): RouteState {
  if (!isKnownDevice(deviceChannelCount)) return state;

  return {
    tracks: state.tracks.map((track) => ({
      inputChannels: track.inputChannels.filter((channel) => isValidChannel(channel, deviceChannelCount)),
      outputChannels: track.outputChannels.filter((channel) => isValidChannel(channel, deviceChannelCount)),
    })),
    savedBuses: state.savedBuses.filter((bus) => isValidChannel(bus.outputChannel, deviceChannelCount)),
    masterMixdown: state.masterMixdown,
  };
}

export function createRouteStore(): UseBoundStore<StoreApi<RouteStoreState>> {
  return create<RouteStoreState>()((set, get) => ({
    routesBySession: {},

    ensureSession(sessionId, initial) {
      const existing = get().getRouteState(sessionId);
      if (existing && hasSameTrackShape(existing, initial)) return existing;

      const seeded = cloneRouteState(initial);
      set((state) => ({
        routesBySession: { ...state.routesBySession, [sessionId]: seeded },
      }));
      return seeded;
    },

    getRouteState(sessionId) {
      const { routesBySession } = get();
      return Object.prototype.hasOwnProperty.call(routesBySession, sessionId)
        ? routesBySession[sessionId]
        : null;
    },

    updateTrackInput(sessionId, trackIndex, inputChannels) {
      const current = get().getRouteState(sessionId);
      if (!current || !hasTrackAtIndex(current, trackIndex)) return null;

      const next: RouteState = {
        ...current,
        tracks: current.tracks.map((track, index) => (
          index === trackIndex
            ? { ...track, inputChannels: [...inputChannels] }
            : track
        )),
      };
      set((state) => ({
        routesBySession: { ...state.routesBySession, [sessionId]: next },
      }));
      return next;
    },

    updateTrackOutput(sessionId, trackIndex, outputChannels) {
      const current = get().getRouteState(sessionId);
      if (!current || !hasTrackAtIndex(current, trackIndex)) return null;

      const next: RouteState = {
        ...current,
        tracks: current.tracks.map((track, index) => (
          index === trackIndex
            ? { ...track, outputChannels: [...outputChannels] }
            : track
        )),
      };
      set((state) => ({
        routesBySession: { ...state.routesBySession, [sessionId]: next },
      }));
      return next;
    },

    updateSavedBuses(sessionId, savedBuses) {
      const current = get().getRouteState(sessionId);
      if (!current) return null;

      const next: RouteState = {
        ...current,
        savedBuses: savedBuses.map((bus) => ({ ...bus })),
      };
      set((state) => ({
        routesBySession: { ...state.routesBySession, [sessionId]: next },
      }));
      return next;
    },

    setMasterMixdown(sessionId, masterMixdown) {
      const current = get().getRouteState(sessionId);
      if (!current) return null;

      const next: RouteState = { ...current, masterMixdown };
      set((state) => ({
        routesBySession: { ...state.routesBySession, [sessionId]: next },
      }));
      return next;
    },

    validateForDevice(sessionId, deviceChannelCount) {
      const current = get().getRouteState(sessionId);
      if (!current) return null;

      const next = validateRouteState(current, deviceChannelCount);
      set((state) => ({
        routesBySession: { ...state.routesBySession, [sessionId]: next },
      }));
      return next;
    },
  }));
}

export const useRouteStore = createRouteStore();
