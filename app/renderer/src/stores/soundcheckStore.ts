// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Single source of truth for the Virtual Soundcheck playback tab (TD-001
// slice 6d, #702): session/device/routing/transport state, ported from
// inline-app.js's sc* module vars and function family (scManifest/
// scSessionDir/scRoutes/scDeviceChannels/scPlaying, scLoadDevices/
// scChooseSession/scPlay/scStop/the sb.onPlaybackEvent handler). Follows
// liveCaptureStore.ts's factory pattern — an injected API so side effects
// stay testable — and reads the pure playback-routing.js classic-script off
// `window` via soundcheck-panel.ts's typed accessor, same convention as
// liveCaptureStore.ts's armState/groupState/rigKind reads. `lastElapsedTick`/
// `lastMeterTick` are bypass fields (ADR-0005): soundcheck-transport-
// controller.ts reads them directly and patches the DOM, never through a
// React re-render.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSpectrumStore } from './spectrumStore';
import type {
  PlaybackApi,
  DialogApi,
  GenerateSessionPeaksResult,
  SessionPeaksDto,
} from '../../../electron/ipc/api';
import {
  outputDeviceListView,
  mixdownNoticeText,
  getPlaybackRouting,
  sameTrackShape,
  type SessionManifest,
  type SoundcheckOutputDevice,
  type SoundcheckMeterTrack,
} from '../soundcheck-panel';

export type SoundcheckApi = Pick<
  PlaybackApi,
  'listOutputDevices' | 'startPlayback' | 'stopPlayback' | 'readSession' | 'onPlaybackEvent' | 'generateSessionPeaks'
> &
  Pick<DialogApi, 'openDirDialog'>;

export interface SoundcheckState {
  manifest: SessionManifest | null;
  sessionDir: string | null;
  routes: number[][];
  devices: SoundcheckOutputDevice[];
  devicesLoaded: boolean;
  selectedDevice: string;
  deviceChannels: number;
  master: boolean;
  playing: boolean;
  elapsedText: string | null;
  mixdownNotice: string | null;
  statusMessage: string | null;
  lastElapsedTick: { elapsed: number; duration: number } | null;
  lastMeterTick: SoundcheckMeterTrack[] | null;
  // Per-track waveform peaks (#734), generated in the background after a
  // successful read-session. Auxiliary: generation failure is silent and never
  // blocks the soundcheck workflow (story 3 renders these, not this slice).
  peaks: SessionPeaksDto | null;
  peaksStatus: 'idle' | 'generating' | 'ready' | 'error';

  loadDevices(): Promise<void>;
  selectDevice(value: string): void;
  chooseSession(): Promise<void>;
  setRoute(trackIndex: number, base: number): void;
  setMaster(master: boolean): void;
  play(): Promise<void>;
  stop(): Promise<void>;
  resetTransport(): void;
  bindIpcEvents(): void;
}

// The selected output device's channel count (0 = default output/unknown) —
// port of scSyncDeviceChannels's `<select>` dataset lookup, now reading
// devices[].channels off state instead of an option's dataset.ch.
function deviceChannelsFor(selectedValue: string, devices: SoundcheckOutputDevice[]): number {
  const dev = devices.find((d) => String(d.index) === selectedValue);
  return dev ? dev.channels : 0;
}

interface PlaybackEventData {
  error?: string;
  type?: string;
  active?: boolean;
  elapsed?: number;
  duration?: number;
  tracks?: SoundcheckMeterTrack[];
  requiredChannels?: number;
  outputChannels?: number;
}

export function createSoundcheckStore(getApi: () => SoundcheckApi) {
  return create<SoundcheckState>()((set, get) => ({
    manifest: null,
    sessionDir: null,
    routes: [],
    devices: [],
    devicesLoaded: false,
    selectedDevice: '',
    deviceChannels: 0,
    master: false,
    playing: false,
    elapsedText: null,
    mixdownNotice: null,
    statusMessage: null,
    lastElapsedTick: null,
    lastMeterTick: null,
    peaks: null,
    peaksStatus: 'idle',

    async loadDevices() {
      const result = await getApi().listOutputDevices();
      const view = outputDeviceListView(result);
      const deviceChannels = deviceChannelsFor(get().selectedDevice, view.devices);
      set({
        devices: view.devices,
        devicesLoaded: true,
        deviceChannels,
        mixdownNotice: mixdownNoticeText(get().manifest, get().routes, deviceChannels, get().master),
      });
    },

    selectDevice(value) {
      const deviceChannels = deviceChannelsFor(value, get().devices);
      set({
        selectedDevice: value,
        deviceChannels,
        mixdownNotice: mixdownNoticeText(get().manifest, get().routes, deviceChannels, get().master),
      });
    },

    async chooseSession() {
      const dir = await getApi().openDirDialog();
      if (!dir) return;
      const result = (await getApi().readSession(dir)) as { success?: boolean; error?: string; manifest?: SessionManifest } | null;
      if (!result || !result.success) {
        set({ statusMessage: (result && result.error) || 'Could not read that session.' });
        return;
      }
      const manifest = result.manifest ?? null;
      const prev = get();
      // #755: re-importing the same session with an unchanged track layout must
      // preserve the routing the user set via setRoute — only reseed defaults
      // for a new session or a changed track shape.
      const keepPriorRoutes =
        manifest !== null && dir === prev.sessionDir && sameTrackShape(prev.manifest, manifest);
      const routes = manifest
        ? keepPriorRoutes
          ? prev.routes
          : getPlaybackRouting().defaultRoutes(manifest.tracks)
        : [];
      set({
        statusMessage: null,
        sessionDir: dir,
        manifest,
        routes,
        mixdownNotice: mixdownNoticeText(manifest, routes, prev.deviceChannels, prev.master),
      });

      // #734: trigger background per-track waveform-peak generation after a
      // successful read-session. The manifest/routes are already set above, so
      // the load itself never blocks on the (minutes-scale for a full-length
      // session) decode. Failure is deliberately SILENT — waveform is an
      // auxiliary background artifact and must not clobber the workflow's
      // statusMessage or block soundcheck.
      set({ peaks: null, peaksStatus: 'generating' });
      const peaksResult = (await getApi().generateSessionPeaks(dir)) as GenerateSessionPeaksResult | null | undefined;
      if (peaksResult?.success) {
        set({ peaks: peaksResult.peaks, peaksStatus: 'ready' });
      } else {
        set({ peaksStatus: 'error' });
      }
    },

    setRoute(trackIndex, base) {
      const state = get();
      const track = state.manifest?.tracks[trackIndex];
      if (!track) return;
      const nextRoute = track.kind === 'stereo' ? [base, base + 1] : [base];
      const routes = state.routes.map((r, i) => (i === trackIndex ? nextRoute : r));
      set({ routes, mixdownNotice: mixdownNoticeText(state.manifest, routes, state.deviceChannels, state.master) });
    },

    setMaster(master) {
      const state = get();
      set({ master, mixdownNotice: mixdownNoticeText(state.manifest, state.routes, state.deviceChannels, master) });
    },

    async play() {
      const state = get();
      if (!state.manifest) return;
      set({ statusMessage: null });
      const result = (await getApi().startPlayback({
        sessionDir: state.sessionDir ?? '',
        device: state.selectedDevice || undefined,
        route: getPlaybackRouting().routeSpec(state.routes),
        master: state.master || undefined,
      })) as { success?: boolean; error?: string } | undefined;
      if (result?.success === false) {
        set({ statusMessage: result.error || 'Could not start playback.' });
        return;
      }
      set({ playing: true, elapsedText: '0:00 / 0:00' });
      useSpectrumStore.getState().setPanelState('empty', 'Buffering…');
    },

    async stop() {
      await getApi().stopPlayback();
      get().resetTransport();
    },

    resetTransport() {
      set({ playing: false, elapsedText: null });
      if (useLiveCaptureStore.getState().appMode === 'soundcheck') {
        useSpectrumStore.getState().setPanelState('empty', 'Load a session and press Play to see per-track meters');
      }
    },

    bindIpcEvents() {
      getApi().onPlaybackEvent((data) => {
        const evt = data as PlaybackEventData | null;
        if (!evt) return;
        if (evt.error) {
          set({ statusMessage: String(evt.error) });
          get().resetTransport();
          return;
        }
        if (evt.type === 'mixdown') {
          if (evt.active) {
            set({ mixdownNotice: `Stereo master mixdown — routing needed ${evt.requiredChannels} channels, device has ${evt.outputChannels}.` });
          }
          return;
        }
        if (evt.type === 'progress') {
          if (useLiveCaptureStore.getState().appMode === 'soundcheck' && get().playing) {
            set({ lastElapsedTick: { elapsed: evt.elapsed ?? 0, duration: evt.duration ?? 0 } });
          }
          return;
        }
        if (evt.type === 'level') {
          if (useLiveCaptureStore.getState().appMode === 'soundcheck' && get().playing) {
            set({ lastMeterTick: evt.tracks ?? [] });
          }
          return;
        }
        if (evt.type === 'ended') {
          get().resetTransport();
        }
      });
    },
  }));
}

export const useSoundcheckStore = createSoundcheckStore(getSoundBuddy);
