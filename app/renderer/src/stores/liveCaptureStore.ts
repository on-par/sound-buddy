// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Single source of truth for the Live-capture center pane (TD-001 slice 5,
// #423): devices, capture state, channel config/groups/collapse, the rolling
// live-window buffer, and the LLM countdown. Follows the createNarrativeStore
// factory pattern (narrativeStore.ts) — an injected API so side effects stay
// testable — and reads the pure helper modules (arm-state.js, group-state.js,
// collapse-state.js, rig-kind.js) off `window` via typed accessors
// (ReportCardIsland.tsx's pattern) rather than importing them: they're classic
// scripts loaded once by App.tsx's boot sequence, and a second ES import would
// risk a second, divergent copy of their (stateless, but singleton-loaded)
// module.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { useSettingsStore } from './settingsStore';
import type { LiveApi, DialogApi, StartLiveOpts } from '../../../electron/ipc/api';
import {
  deviceListView,
  deviceChannelCount,
  usedChannelCount,
  type LiveDevice,
  type DeviceHint,
  type StripConfig,
  type ChannelGroup,
  type LiveEvent,
  type ChannelWindowData,
  type ListDevicesResult,
} from '../live-capture-panel';

export type LiveCaptureApi = Pick<LiveApi, 'listDevices' | 'startLive' | 'stopLive' | 'onLiveEvent'> &
  Pick<DialogApi, 'openDirDialog'>;

// Rolling live-window buffer cap — mirrors the inline `if (liveWindows.length
// > 10) liveWindows.shift()` (#208's LLM trend context / report-card source).
export const LIVE_WINDOWS_CAP = 10;
// Shared label-entry cap (config row + inline live header), same as the
// inline MAX_LABEL_LEN.
export const MAX_LABEL_LEN = 40;
// The AI countdown ticks once a second, same cadence as the inline
// startLiveCountdown's setInterval.
export const COUNTDOWN_TICK_MS = 1000;

export interface RingoutCut {
  freq: number;
  gainDb: number;
  q: number;
}

export interface RingoutState {
  stepIndex: number;
  cut: RingoutCut | null;
}

export interface StartCaptureOpts {
  windowSecs: number;
  intervalSecs: number;
  llmIntervalSecs: number;
}

export interface StartCaptureResult {
  success: boolean;
  error?: string;
}

export interface StopCaptureResult {
  success: boolean;
  sessionDir: string | null;
}

/* ── Typed `window.*` accessors for the pure helper classic-scripts ──
 * Mirrors ReportCardIsland.tsx's getGrading()/getPhaseDoublingState() style:
 * these modules are boot-injected once (App.tsx's BOOT_SCRIPTS) and read off
 * `window` rather than imported, so the store shares the exact same instance
 * inline-app.js reads. */
interface ArmStateApi {
  isArmed(strip: StripConfig | null | undefined): boolean;
  allTokens(cfg: StripConfig[]): string[];
  armedTokens(cfg: StripConfig[]): string[];
  setAllArmed(cfg: StripConfig[], armed: boolean): StripConfig[];
  stripToken(strip: StripConfig): string;
}
interface ChannelLabelsApi {
  applyLabels(
    cfg: StripConfig[] | null | undefined,
    tokens: string[] | null | undefined,
    savedForDevice: Record<string, string> | null | undefined,
  ): StripConfig[];
  recordLabel(
    all: Record<string, Record<string, string>> | null | undefined,
    deviceName: string,
    token: string,
    label: string,
  ): Record<string, Record<string, string>>;
}
interface GroupStateApi {
  assign(groups: ChannelGroup[], idx: number, g: number): ChannelGroup[];
  pruneStrip(groups: ChannelGroup[], idx: number): ChannelGroup[];
  addGroup(groups: ChannelGroup[], name: string): ChannelGroup[];
  removeGroup(groups: ChannelGroup[], g: number): ChannelGroup[];
  renameGroup(groups: ChannelGroup[], g: number, name: string): ChannelGroup[];
}
interface CollapseStateApi {
  isCollapsed(set: ReadonlySet<number>, id: number): boolean;
  toggle(set: ReadonlySet<number>, id: number): Set<number>;
  collapseAll(ids: number[]): Set<number>;
  expandAll(): Set<number>;
}
interface RigKindApi {
  switchKind(strip: StripConfig, kind: string, maxChannels: number): StripConfig;
}
function getArmState(): ArmStateApi {
  return (window as unknown as { armState: ArmStateApi }).armState;
}
function getChannelLabels(): ChannelLabelsApi {
  return (window as unknown as { channelLabels: ChannelLabelsApi }).channelLabels;
}
function getGroupState(): GroupStateApi {
  return (window as unknown as { groupState: GroupStateApi }).groupState;
}
function getCollapseState(): CollapseStateApi {
  return (window as unknown as { collapseState: CollapseStateApi }).collapseState;
}
function getRigKind(): RigKindApi {
  return (window as unknown as { rigKind: RigKindApi }).rigKind;
}

// First <= 2 device channels as mono strips — the device-default seed used by
// both loadDevices() (devices just arrived) and selectDevice() (device
// switched), mirroring inline-app.js's resetChannelConfig().
function defaultChannelConfig(deviceChannels: number): StripConfig[] {
  const cfg: StripConfig[] = [];
  for (let i = 0; i < Math.min(2, deviceChannels); i++) {
    cfg.push({ kind: 'mono', a: i, b: (i + 1) % Math.max(deviceChannels, 1), armed: true });
  }
  return cfg;
}

// The selected device's name, resolved from the device list ('' = Default
// Device) — mirrors inline-app.js's selectedDeviceName() (#482).
function deviceNameFor(selectedValue: string, devices: LiveDevice[]): string {
  if (selectedValue === '') return '';
  const dev = devices.find((d) => String(d.index) === selectedValue);
  return dev ? dev.name : '';
}

// Overlay persisted channel labels (#482) for `deviceName` onto a freshly
// seeded channel config — shared by loadDevices()/selectDevice().
function withSavedLabels(cfg: StripConfig[], deviceName: string): StripConfig[] {
  const channelLabels = (useSettingsStore.getState().settings || {}).channelLabels || {};
  const tokens = getArmState().allTokens(cfg);
  return getChannelLabels().applyLabels(cfg, tokens, channelLabels[deviceName] || {});
}

export interface LiveCaptureState {
  devices: LiveDevice[];
  deviceHint: DeviceHint | null;
  selectedDevice: string;

  channelConfig: StripConfig[];
  channelGroups: ChannelGroup[];
  collapsed: ReadonlySet<number>;

  liveMode: 'monitor' | 'record';
  recordDir: string;

  isCapturing: boolean;

  liveWindows: LiveEvent[];
  lastTick: LiveEvent | null;
  lastLiveChannels: ChannelWindowData[] | null;
  // Bumped whenever a tick's channel count differs from the previous tick's
  // — the island's cue to re-render the board shape instead of patch it.
  boardShapeVersion: number;
  lastError: string | null;

  countdownSecs: number | null;
  countdownAnalyzing: boolean;

  // The active mode-tab, dual-written by the still-inline tab handler; read
  // by NarrativePanel/LiveCaptureIsland instead of importing currentMode.
  appMode: string;

  ringout: RingoutState;

  loadDevices(): Promise<void>;
  selectDevice(value: string): void;
  setLiveMode(mode: 'monitor' | 'record'): void;
  setRecordDir(dir: string): void;
  setAppMode(mode: string): void;

  addStrip(): void;
  removeStrip(idx: number): void;
  setStripKind(idx: number, kind: string): void;
  setStripSource(idx: number, field: 'a' | 'b', channel: number): void;
  setStripLabel(idx: number, label: string): void;
  assignGroup(idx: number, group: number): void;
  addGroup(name: string): void;
  renameGroup(group: number, name: string): void;
  removeGroup(group: number): void;
  toggleCollapse(idx: number): void;
  setGroupCollapsed(group: number, collapsed: boolean): void;
  collapseAll(stripCount: number): void;
  expandAll(): void;
  toggleArm(idx: number): void;
  setAllArmed(armed: boolean): void;

  startCapture(opts: StartCaptureOpts): Promise<StartCaptureResult | undefined>;
  stopCapture(): Promise<StopCaptureResult | undefined>;
  clearLiveWindows(): void;
  bindIpcEvents(): void;

  setRingout(patch: Partial<RingoutState>): void;
}

export function createLiveCaptureStore(getApi: () => LiveCaptureApi) {
  // Countdown timer id — not store state (not serializable / not meaningful
  // to subscribers), mirrors the inline module-level `liveCountdownTimer`.
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  function clearCountdownTimer() {
    if (countdownTimer != null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  return create<LiveCaptureState>()((set, get) => ({
    devices: [],
    deviceHint: null,
    selectedDevice: '',

    channelConfig: [],
    channelGroups: [],
    collapsed: new Set<number>(),

    liveMode: 'monitor',
    recordDir: '',

    isCapturing: false,

    liveWindows: [],
    lastTick: null,
    lastLiveChannels: null,
    boardShapeVersion: 0,
    lastError: null,

    countdownSecs: null,
    countdownAnalyzing: false,

    appMode: 'reportcard',

    ringout: { stepIndex: 0, cut: null },

    async loadDevices() {
      const result = (await getApi().listDevices()) as ListDevicesResult;
      const view = deviceListView(result);
      set({ devices: view.devices, deviceHint: view.hint });
      if (view.devices.length) {
        const selected = get().selectedDevice;
        const n = deviceChannelCount(selected, view.devices);
        const deviceName = deviceNameFor(selected, view.devices);
        set({ channelConfig: withSavedLabels(defaultChannelConfig(n), deviceName) });
      }
    },

    selectDevice(value) {
      set({ selectedDevice: value });
      const devices = get().devices;
      const n = deviceChannelCount(value, devices);
      const deviceName = deviceNameFor(value, devices);
      set({ channelConfig: withSavedLabels(defaultChannelConfig(n), deviceName) });
    },

    setLiveMode(mode) {
      set({ liveMode: mode === 'record' ? 'record' : 'monitor' });
    },

    setRecordDir(dir) {
      set({ recordDir: dir });
    },

    setAppMode(mode) {
      set({ appMode: mode });
    },

    addStrip() {
      const state = get();
      const n = deviceChannelCount(state.selectedDevice, state.devices);
      const next = Math.min(usedChannelCount(state.channelConfig), n - 1);
      set({
        channelConfig: [
          ...state.channelConfig,
          { kind: 'mono', a: next, b: Math.min(next + 1, n - 1), armed: true },
        ],
      });
    },

    removeStrip(idx) {
      const state = get();
      set({
        channelConfig: state.channelConfig.filter((_, i) => i !== idx),
        channelGroups: getGroupState().pruneStrip(state.channelGroups, idx),
      });
    },

    setStripKind(idx, kind) {
      const state = get();
      const strip = state.channelConfig[idx];
      if (!strip) return;
      const n = deviceChannelCount(state.selectedDevice, state.devices);
      const updated = getRigKind().switchKind(strip, kind, n);
      set({ channelConfig: state.channelConfig.map((s, i) => (i === idx ? updated : s)) });
    },

    setStripSource(idx, field, channel) {
      const state = get();
      if (!state.channelConfig[idx]) return;
      set({
        channelConfig: state.channelConfig.map((s, i) => (i === idx ? { ...s, [field]: channel } : s)),
      });
    },

    setStripLabel(idx, label) {
      const state = get();
      const strip = state.channelConfig[idx];
      if (!strip) return;
      const trimmed = label.trim().slice(0, MAX_LABEL_LEN);
      set({
        channelConfig: state.channelConfig.map((s, i) => (i === idx ? { ...s, label: trimmed } : s)),
      });
      // Persist the label (#482) so it survives across monitor/live sessions,
      // keyed by device + strip token (mono "0" / stereo "2-3").
      const all = (useSettingsStore.getState().settings || {}).channelLabels || {};
      const deviceName = deviceNameFor(state.selectedDevice, state.devices);
      const token = getArmState().stripToken(strip);
      const next = getChannelLabels().recordLabel(all, deviceName, token, trimmed);
      void useSettingsStore.getState().updateSettings({ channelLabels: next });
    },

    assignGroup(idx, group) {
      set((state) => ({ channelGroups: getGroupState().assign(state.channelGroups, idx, group) }));
    },

    addGroup(name) {
      set((state) => ({ channelGroups: getGroupState().addGroup(state.channelGroups, name) }));
    },

    renameGroup(group, name) {
      set((state) => ({ channelGroups: getGroupState().renameGroup(state.channelGroups, group, name) }));
    },

    removeGroup(group) {
      set((state) => ({ channelGroups: getGroupState().removeGroup(state.channelGroups, group) }));
    },

    toggleCollapse(idx) {
      set((state) => ({ collapsed: getCollapseState().toggle(state.collapsed, idx) }));
    },

    setGroupCollapsed(group, collapsedFlag) {
      const state = get();
      const members = state.channelGroups[group]?.members ?? [];
      let collapsed: ReadonlySet<number> = state.collapsed;
      const cs = getCollapseState();
      members.forEach((m) => {
        if (cs.isCollapsed(collapsed, m) !== collapsedFlag) collapsed = cs.toggle(collapsed, m);
      });
      set({ collapsed });
    },

    collapseAll(stripCount) {
      set({ collapsed: getCollapseState().collapseAll(Array.from({ length: stripCount }, (_, i) => i)) });
    },

    expandAll() {
      set({ collapsed: getCollapseState().expandAll() });
    },

    toggleArm(idx) {
      const state = get();
      const strip = state.channelConfig[idx];
      if (!strip) return;
      const armed = !getArmState().isArmed(strip);
      set({ channelConfig: state.channelConfig.map((s, i) => (i === idx ? { ...s, armed } : s)) });
    },

    setAllArmed(armed) {
      set((state) => ({ channelConfig: getArmState().setAllArmed(state.channelConfig, armed) }));
    },

    async startCapture(opts) {
      if (get().isCapturing) return undefined;
      set({ isCapturing: true, liveWindows: [] });
      const state = get();
      const arm = getArmState();
      const payload: StartLiveOpts = {
        device: state.selectedDevice || undefined,
        channels: arm.allTokens(state.channelConfig),
        windowSecs: opts.windowSecs,
        intervalSecs: opts.intervalSecs,
        llmIntervalSecs: opts.llmIntervalSecs,
        mode: state.liveMode,
        recordDir: state.recordDir || undefined,
        arm: state.liveMode === 'record' ? arm.armedTokens(state.channelConfig) : undefined,
        // Record mode: carry display labels into stem filenames + session.json (#482).
        labels:
          state.liveMode === 'record'
            ? state.channelConfig.map((s) => (s.label ?? '').trim())
            : undefined,
      };
      const result = (await getApi().startLive(payload)) as StartCaptureResult;
      if (!result.success) {
        set({ isCapturing: false });
        return result;
      }
      clearCountdownTimer();
      if (opts.llmIntervalSecs > 0) {
        set({ countdownSecs: opts.llmIntervalSecs, countdownAnalyzing: false });
        countdownTimer = setInterval(() => {
          set((s) => {
            if (s.countdownSecs == null) return {};
            const next = s.countdownSecs - 1;
            if (next <= 0) return { countdownSecs: opts.llmIntervalSecs, countdownAnalyzing: true };
            return { countdownSecs: next, countdownAnalyzing: false };
          });
        }, COUNTDOWN_TICK_MS);
      } else {
        set({ countdownSecs: null, countdownAnalyzing: false });
      }
      return result;
    },

    async stopCapture() {
      set({ isCapturing: false, countdownSecs: null, countdownAnalyzing: false });
      clearCountdownTimer();
      const result = (await getApi().stopLive()) as StopCaptureResult;
      return result;
    },

    clearLiveWindows() {
      set({ liveWindows: [] });
    },

    bindIpcEvents() {
      getApi().onLiveEvent((data) => {
        const evt = data as
          | (LiveEvent & { error?: string })
          | { error: string }
          | null;
        if (!evt || (evt as { error?: string }).error) {
          set({ lastError: (evt as { error?: string })?.error ?? null });
          return;
        }
        const tick = evt as LiveEvent;
        const channels = tick.channels;
        set((state) => {
          const patch: Partial<LiveCaptureState> = { lastTick: tick };
          if (channels) {
            patch.lastLiveChannels = channels;
            if (!state.lastLiveChannels || state.lastLiveChannels.length !== channels.length) {
              patch.boardShapeVersion = state.boardShapeVersion + 1;
            }
          }
          return patch;
        });
        if (tick.type === 'window' || typeof (tick as { window?: number }).window === 'number') {
          set((state) => {
            const next = [...state.liveWindows, tick];
            if (next.length > LIVE_WINDOWS_CAP) next.shift();
            return { liveWindows: next };
          });
        }
      });
    },

    setRingout(patch) {
      set((state) => ({ ringout: { ...state.ringout, ...patch } }));
    },
  }));
}

export const useLiveCaptureStore = createLiveCaptureStore(getSoundBuddy);
