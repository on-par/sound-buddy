// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Console scan/identity state (#884): a createXStore(deps) factory mirroring
// sceneDiffStore.ts's shape — the same `create<T>()` + requestId staleness
// guard style. Every network action gates on
// useConsoleNetworkConsentStore's requestConsent() (Tier 2 / ADR-0006) before
// ever calling the bridge; a decline leaves the store idle with an
// actionable message and sends nothing.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type {
  ConsoleApi,
  ConsoleIdentityDto,
  ConsoleChannelStateDto,
  ConsoleLinkStateDto,
  SceneDiffDto,
  AnalysisApi,
} from '../../../electron/ipc/api';
import { useConsoleNetworkConsentStore } from './consoleNetworkConsentStore';

export type ConsoleScanStatus = 'idle' | 'scanning' | 'done' | 'error';
export type ConsoleIdentityStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type ConsoleIdentitySource = 'scan' | 'manual';
export type ConsoleLiveStateStatus = 'idle' | 'starting' | 'watching' | 'error';
export type ConsoleCaptureStatus = 'idle' | 'capturing' | 'done' | 'cancelled' | 'error';
export type ConsoleSceneDiffStatus = 'idle' | 'diffing' | 'done' | 'error';

export const CONSENT_DECLINED_MESSAGE =
  'Console access is off. Choose "Allow read-only access" when Sound Buddy asks, then scan again.';
export const NO_CONSOLE_SELECTED_MESSAGE =
  'Choose a console from the scan results, or enter its IP, before watching channel state.';
export const LIVE_STATE_FAILED_MESSAGE =
  "Couldn't watch the console's channel state. Check the console is powered on and reachable on the network, then try again.";
export const CAPTURE_FAILED_MESSAGE =
  "Couldn't capture the console scene. Check the console is powered on and reachable, then try again.";
export const CAPTURE_LOCAL_ONLY_MESSAGE =
  'Scene captures are saved locally on this Mac. Nothing is uploaded or shared; scrub channel labels before exporting.';
export const SCENE_DIFF_FAILED_MESSAGE =
  "Couldn't compare those scene captures. Check both files still exist, then try again.";

/** The one literal for "no signal yet" link state (#886) — shared by
 *  INITIAL_STATE and every reset below so there is exactly one copy. */
export const INITIAL_CONSOLE_LINK: ConsoleLinkStateDto = { status: 'unknown', metersDegraded: false };

export interface ConsoleState {
  scanStatus: ConsoleScanStatus;
  found: ConsoleIdentityDto[];
  scanError: string | null;
  selectedIp: string | null;
  identity: ConsoleIdentityDto | null;
  identitySource: ConsoleIdentitySource | null;
  identityStatus: ConsoleIdentityStatus;
  identityError: string | null;
  manualIp: string;
  liveChannels: ConsoleChannelStateDto[];
  liveStateStatus: ConsoleLiveStateStatus;
  liveStateError: string | null;
  /** Meter input levels, linear 0..1, index 0 = channel 1 (#978). Independent
   *  of liveChannels — cleared everywhere liveChannels is cleared. */
  liveMeters: number[];
  /** Console link health (#886) — reachability + meter-subscription liveness.
   *  Independent of liveStateStatus: a healthy watch session can still show
   *  an offline console or degraded meters mid-session. */
  link: ConsoleLinkStateDto;
  captureStatus: ConsoleCaptureStatus;
  captureDone: number;
  captureTotal: number;
  captureFilePath: string | null;
  captureError: string | null;
  captureHistory: string[];
  sceneDiffStatus: ConsoleSceneDiffStatus;
  sceneDiff: SceneDiffDto | null;
  sceneDiffNameA: string | null;
  sceneDiffNameB: string | null;
  sceneDiffError: string | null;
  scan(): Promise<void>;
  selectConsole(ip: string): Promise<void>;
  setManualIp(value: string): void;
  submitManualIp(): Promise<void>;
  startLiveState(): Promise<void>;
  stopLiveState(): Promise<void>;
  startSceneCapture(): Promise<void>;
  cancelSceneCapture(): Promise<void>;
  compareLastSceneCaptures(): Promise<void>;
}

const INITIAL_STATE = {
  scanStatus: 'idle' as ConsoleScanStatus,
  found: [] as ConsoleIdentityDto[],
  scanError: null as string | null,
  selectedIp: null as string | null,
  identity: null as ConsoleIdentityDto | null,
  identitySource: null as ConsoleIdentitySource | null,
  identityStatus: 'idle' as ConsoleIdentityStatus,
  identityError: null as string | null,
  manualIp: '',
  liveChannels: [] as ConsoleChannelStateDto[],
  liveStateStatus: 'idle' as ConsoleLiveStateStatus,
  liveStateError: null as string | null,
  liveMeters: [] as number[],
  link: INITIAL_CONSOLE_LINK,
  captureStatus: 'idle' as ConsoleCaptureStatus,
  captureDone: 0,
  captureTotal: 0,
  captureFilePath: null as string | null,
  captureError: null as string | null,
  captureHistory: [] as string[],
  sceneDiffStatus: 'idle' as ConsoleSceneDiffStatus,
  sceneDiff: null as SceneDiffDto | null,
  sceneDiffNameA: null as string | null,
  sceneDiffNameB: null as string | null,
  sceneDiffError: null as string | null,
};

export function createConsoleStore(
  getApi: () => ConsoleApi & Pick<AnalysisApi, 'diffScenes'>,
  requestConsent: () => Promise<boolean>
): UseBoundStore<StoreApi<ConsoleState>> {
  // Bumped on every scan/selectConsole/submitManualIp call so an in-flight
  // reply can tell it's been superseded (e.g. two scans in quick succession)
  // and skip applying its now-stale result — private closure plumbing, not
  // store state, mirroring sceneDiffStore.ts's requestId guard.
  let scanRequestId = 0;
  let identityRequestId = 0;
  // Bound once, on the first startLiveState call — a second start must not
  // register a second onConsoleLiveState listener (it would double-apply
  // every future snapshot).
  let liveStateBound = false;
  let captureProgressBound = false;

  return create<ConsoleState>()((set, get) => ({
    ...INITIAL_STATE,

    async scan() {
      if (!(await requestConsent())) {
        set({ scanStatus: 'idle', scanError: CONSENT_DECLINED_MESSAGE });
        return;
      }

      const myRequestId = (scanRequestId += 1);
      set({ scanStatus: 'scanning', scanError: null });
      try {
        const result = await getApi().scanConsoles();
        if (myRequestId !== scanRequestId) return;
        if (result.success) {
          set({ scanStatus: 'done', found: result.consoles, scanError: null });
        } else {
          set({ scanStatus: 'error', scanError: result.error, found: [] });
        }
      } catch {
        if (myRequestId !== scanRequestId) return;
        set({
          scanStatus: 'error',
          scanError: "Couldn't scan for a console. Check this Mac is on the same network as the console, then try again.",
          found: [],
        });
      }
    },

    async selectConsole(ip) {
      if (!(await requestConsent())) {
        set({ identityStatus: 'error', identityError: CONSENT_DECLINED_MESSAGE, identity: null });
        return;
      }

      const myRequestId = (identityRequestId += 1);
      set({ selectedIp: ip, identityStatus: 'loading', identitySource: 'scan', identityError: null });
      try {
        const result = await getApi().fetchConsoleIdentity(ip);
        if (myRequestId !== identityRequestId) return;
        if (result.success) {
          set({ identity: result.identity, identityStatus: 'loaded', identityError: null });
        } else {
          set({ identityStatus: 'error', identityError: result.error, identity: null });
        }
      } catch {
        if (myRequestId !== identityRequestId) return;
        set({
          identityStatus: 'error',
          identityError:
            "Couldn't read the console's identity. Check the IP is correct and the console is powered on and reachable on the network.",
          identity: null,
        });
      }
    },

    setManualIp(value) {
      set({ manualIp: value });
    },

    async submitManualIp() {
      const ip = get().manualIp.trim();
      if (ip === '') return;

      if (!(await requestConsent())) {
        set({ identityStatus: 'error', identityError: CONSENT_DECLINED_MESSAGE, identity: null });
        return;
      }

      const myRequestId = (identityRequestId += 1);
      set({ selectedIp: ip, identityStatus: 'loading', identitySource: 'manual', identityError: null });
      try {
        const result = await getApi().fetchConsoleIdentity(ip);
        if (myRequestId !== identityRequestId) return;
        if (result.success) {
          set({ identity: result.identity, identityStatus: 'loaded', identityError: null });
        } else {
          set({ identityStatus: 'error', identityError: result.error, identity: null });
        }
      } catch {
        if (myRequestId !== identityRequestId) return;
        set({
          identityStatus: 'error',
          identityError:
            "Couldn't read the console's identity. Check the IP is correct and the console is powered on and reachable on the network.",
          identity: null,
        });
      }
    },

    async startLiveState() {
      const ip = get().selectedIp;
      if (!ip) {
        set({ liveStateStatus: 'error', liveStateError: NO_CONSOLE_SELECTED_MESSAGE });
        return;
      }
      if (!(await requestConsent())) {
        set({
          liveStateStatus: 'error',
          liveStateError: CONSENT_DECLINED_MESSAGE,
          liveChannels: [],
          liveMeters: [],
          link: INITIAL_CONSOLE_LINK,
        });
        return;
      }
      if (!liveStateBound) {
        liveStateBound = true;
        getApi().onConsoleLiveState((evt) => {
          if ('error' in evt) {
            set({ liveStateStatus: 'error', liveStateError: evt.error });
            return;
          }
          if ('meters' in evt) {
            set({ liveMeters: evt.meters.inputs });
            return;
          }
          if ('link' in evt) {
            set({ link: evt.link });
            return;
          }
          set({ liveChannels: evt.channels, liveStateStatus: 'watching', liveStateError: null });
        });
      }
      // Set 'starting' after the listener bind so a push that lands during
      // the round trip below can't be lost.
      set({ liveStateStatus: 'starting', liveStateError: null, link: INITIAL_CONSOLE_LINK });
      try {
        const result = await getApi().startConsoleLiveState(ip);
        if (result.success) {
          set({ liveStateStatus: 'watching', liveStateError: null });
        } else {
          set({
            liveStateStatus: 'error',
            liveStateError: result.error,
            liveChannels: [],
            liveMeters: [],
            link: INITIAL_CONSOLE_LINK,
          });
        }
      } catch {
        set({
          liveStateStatus: 'error',
          liveStateError: LIVE_STATE_FAILED_MESSAGE,
          liveChannels: [],
          liveMeters: [],
          link: INITIAL_CONSOLE_LINK,
        });
      }
    },

    async stopLiveState() {
      try {
        await getApi().stopConsoleLiveState();
        set({ liveStateStatus: 'idle', liveStateError: null, liveMeters: [], link: INITIAL_CONSOLE_LINK });
      } catch {
        set({ liveStateStatus: 'error', liveStateError: LIVE_STATE_FAILED_MESSAGE });
      }
    },

    async startSceneCapture() {
      const ip = get().selectedIp;
      if (!ip) {
        set({ captureStatus: 'error', captureError: NO_CONSOLE_SELECTED_MESSAGE });
        return;
      }
      if (!(await requestConsent())) {
        set({ captureStatus: 'error', captureError: CONSENT_DECLINED_MESSAGE });
        return;
      }
      if (!captureProgressBound) {
        captureProgressBound = true;
        getApi().onConsoleSceneCaptureProgress(({ done, total }) => {
          set({ captureDone: done, captureTotal: total });
        });
      }
      set({ captureStatus: 'capturing', captureDone: 0, captureTotal: 0, captureFilePath: null, captureError: null });
      try {
        const result = await getApi().startConsoleSceneCapture(ip);
        if (result.success) {
          const captureHistory = [...get().captureHistory, result.filePath].slice(-2);
          set({ captureStatus: 'done', captureFilePath: result.filePath, captureError: null, captureHistory });
        } else {
          set({
            captureStatus: result.cancelled ? 'cancelled' : 'error',
            captureFilePath: null,
            captureError: result.error,
          });
        }
      } catch {
        set({ captureStatus: 'error', captureFilePath: null, captureError: CAPTURE_FAILED_MESSAGE });
      }
    },

    async cancelSceneCapture() {
      try {
        await getApi().cancelConsoleSceneCapture();
      } catch {
        set({ captureStatus: 'error', captureError: CAPTURE_FAILED_MESSAGE });
      }
    },

    async compareLastSceneCaptures() {
      const [pathA, pathB] = get().captureHistory;
      if (!pathA || !pathB) return;
      set({ sceneDiffStatus: 'diffing', sceneDiff: null, sceneDiffError: null, sceneDiffNameA: null, sceneDiffNameB: null });
      try {
        const result = await getApi().diffScenes({ pathA, pathB });
        if (result.ok) {
          set({
            sceneDiffStatus: 'done',
            sceneDiff: result.diff,
            sceneDiffNameA: result.nameA,
            sceneDiffNameB: result.nameB,
            sceneDiffError: null,
          });
        } else {
          set({ sceneDiffStatus: 'error', sceneDiff: null, sceneDiffError: result.error });
        }
      } catch {
        set({ sceneDiffStatus: 'error', sceneDiff: null, sceneDiffError: SCENE_DIFF_FAILED_MESSAGE });
      }
    },
  }));
}

export const useConsoleStore = createConsoleStore(getSoundBuddy, () =>
  useConsoleNetworkConsentStore.getState().requestConsent()
);
