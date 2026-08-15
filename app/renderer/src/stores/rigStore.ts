// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Single source of truth for saved capture setups ("rigs") and the preflight
// lock (TD-001 slice 6d, #702): CRUD/apply actions ported from
// inline-app.js's rigList module var + initRigs/applyRig/captureCurrentRig/
// rigSaveAs/setRigControlsEnabled family. Follows liveCaptureStore.ts's
// factory pattern — an injected API so side effects stay testable. Business
// logic (snapshotting the current setup, resolving/clamping a rig against
// the device list) lives in rig-panel.ts's pure functions; this store wires
// them to IPC and to liveCaptureStore's state.
//
// Every UI-facing action here has no `window.renderChannelConfig?.()` bridge
// call EXCEPT the two that actually mutate liveCaptureStore's channelConfig/
// liveMode/selectedDevice (loadRigs/selectRig, via applyRigById) — save/
// saveAs/rename/remove/saveBaseline only touch this store's own `rigs`/
// `activeRigId`, which RigControls.tsx/PreflightPanel.tsx already re-render
// from reactively, unlike the old imperative populateRigSelect()/
// renderPreflight() call sites they replace.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { useLiveCaptureStore, persistGroups, deviceNameFor } from './liveCaptureStore';
import { useSettingsStore } from './settingsStore';
import type { RigApi, SettingsApi, CaptureRig } from '../../../electron/ipc/api';
import {
  captureCurrentRigSnapshot,
  applyRigPatch,
  setLiveStatusText,
  getPreflight,
  type CaptureRigSnapshotInput,
  type ExistingRig,
} from '../rig-panel';
import { deviceChannelCount, type StripConfig } from '../live-capture-panel';

export type RigApiSubset = Pick<RigApi, 'listRigs' | 'saveRig' | 'deleteRig' | 'setActiveRig'> & Pick<SettingsApi, 'getSettings'>;

export interface RigState {
  rigs: CaptureRig[];
  activeRigId: string | null;
  // Replaces setRigControlsEnabled's DOM-disabled sweep — locked while a
  // capture is running (rig-apply mutates device/channels/mode, which would
  // desync the UI from the live stream).
  locked: boolean;

  loadRigs(): Promise<void>;
  selectRig(id: string): Promise<void>;
  save(): Promise<void>;
  saveAs(name: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  saveBaseline(): Promise<void>;
  setLocked(locked: boolean): void;
}

interface ChannelLabelsApi {
  applyLabels(cfg: StripConfig[], tokens: string[], savedForDevice: Record<string, string>): StripConfig[];
}
interface ArmStateApi {
  allTokens(cfg: StripConfig[]): string[];
}
function getChannelLabels(): ChannelLabelsApi {
  return (window as unknown as { channelLabels: ChannelLabelsApi }).channelLabels;
}
function getArmState(): ArmStateApi {
  return (window as unknown as { armState: ArmStateApi }).armState;
}

// Builds captureCurrentRigSnapshot()'s `live` input from the current
// liveCaptureStore state — intervalMs/windowSecs (#725) now come straight
// from the store, same as every other field here.
function currentLiveSnapshotInput(): CaptureRigSnapshotInput {
  const live = useLiveCaptureStore.getState();
  return {
    channelConfig: live.channelConfig,
    channelGroups: live.channelGroups,
    measurementSource: live.measurementSource,
    liveMode: live.liveMode,
    recordDir: live.recordDir,
    selectedDeviceName: deviceNameFor(live.selectedDevice, live.devices),
    intervalMs: live.meterIntervalMs,
    windowSecs: live.windowSecs,
  };
}

function rigErrorMessage(action: string): string {
  return `Could not ${action} rig — check that Sound Buddy can write its settings.`;
}

export function createRigStore(getApi: () => RigApiSubset) {
  // Restore a saved rig into the Live tab (port of applyRig(rig)) — resolves
  // the rig's device/channels via rig-panel.ts's applyRigPatch, writes the
  // resulting patch onto liveCaptureStore, persists groups, and repaints the
  // sliders + the still-inline capture lock/measurement badge. Shared by
  // loadRigs() (seeding the picker at boot) and selectRig() (switching rigs).
  function applyRigById(id: string, rigs: CaptureRig[]): void {
    const rig = rigs.find((r) => r.id === id);
    if (!rig) return;
    useLiveCaptureStore.getState().setMeterIntervalMs(rig.intervalMs);
    useLiveCaptureStore.getState().setWindowSecs(rig.windowSecs);
    const live = useLiveCaptureStore.getState();
    const deviceChannels = deviceChannelCount(live.selectedDevice, live.devices);
    const { patch, notice } = applyRigPatch(rig, live.devices, deviceChannels);
    useLiveCaptureStore.setState({ ...patch, rigApplyNotice: notice || null });
    persistGroups(useLiveCaptureStore.getState());
    setLiveStatusText(notice);
    // The board + measurement badge re-render reactively from liveCaptureStore
    // (LiveCapturePanel/MeasurementBadge, TD-001 slice 6h #711) — the old
    // window.renderChannelConfig?.() sweep is gone.
  }

  return create<RigState>()((set, get) => ({
    rigs: [],
    activeRigId: null,
    locked: false,

    async loadRigs() {
      let rigs: CaptureRig[];
      let activeRigId: string | null;
      try {
        const settings = await getApi().getSettings();
        rigs = settings.rigs || [];
        activeRigId = settings.activeRigId || null;
      } catch {
        rigs = [];
        activeRigId = null;
      }
      const active = rigs.some((r) => r.id === activeRigId) ? activeRigId : null;
      set({ rigs, activeRigId: active });
      if (active) applyRigById(active, rigs);
      // Re-apply saved labels (#482): loadDevices() may have seeded
      // channelConfig before settingsStore's settings resolved, so
      // re-overlay now that they're available. Overlays onto the CURRENT
      // channelConfig (unlike liveCaptureStore's selectDevice(), which would
      // also reseed it to the device default) — a direct store write, same
      // rationale as applyRigById's selectedDevice write.
      const live = useLiveCaptureStore.getState();
      const deviceName = deviceNameFor(live.selectedDevice, live.devices);
      const savedLabels = ((useSettingsStore.getState().settings || {}).channelLabels || {})[deviceName] || {};
      useLiveCaptureStore.setState({
        channelConfig: getChannelLabels().applyLabels(live.channelConfig, getArmState().allTokens(live.channelConfig), savedLabels),
      });
      // The board re-renders reactively — no window.renderChannelConfig?.() (6h).
    },

    async selectRig(id) {
      try {
        await getApi().setActiveRig(id || null);
      } catch {
        setLiveStatusText(rigErrorMessage('select'));
        return;
      }
      set({ activeRigId: id || null });
      if (id) applyRigById(id, get().rigs);
      // populateRigSelect's old "programmatic <select> doesn't fire 'change'"
      // gap no longer applies (React re-renders on the store write above) —
      // this covers both the apply and deselect branches uniformly; the board
      // + badge re-render reactively, so no window.renderChannelConfig?.() (6h).
    },

    async save() {
      const state = get();
      if (!state.activeRigId) {
        const name = await window.rigDialog?.({ title: 'Save rig as…', value: '', confirmLabel: 'Save', withInput: true });
        if (typeof name !== 'string') return;
        await get().saveAs(name);
        return;
      }
      const existing = state.rigs.find((r) => r.id === state.activeRigId);
      const existingRef: ExistingRig | null = existing ? { id: existing.id, name: existing.name, baseline: existing.baseline } : null;
      try {
        const snapshot = captureCurrentRigSnapshot(currentLiveSnapshotInput(), existingRef, existing ? existing.name : 'Rig');
        const settings = await getApi().saveRig(snapshot);
        await getApi().setActiveRig(state.activeRigId);
        set({ rigs: settings.rigs || [], activeRigId: state.activeRigId });
        setLiveStatusText(`Saved "${existing ? existing.name : 'rig'}".`);
      } catch {
        setLiveStatusText(rigErrorMessage('save'));
      }
    },

    async saveAs(name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const state = get();
      const prevIds = new Set(state.rigs.map((r) => r.id));
      try {
        const snapshot = captureCurrentRigSnapshot(currentLiveSnapshotInput(), null, trimmed);
        const settings = await getApi().saveRig(snapshot);
        const rigs = settings.rigs || [];
        const created = rigs.find((r) => !prevIds.has(r.id));
        const newId = created ? created.id : (rigs.find((r) => r.name === trimmed)?.id ?? '');
        if (newId) await getApi().setActiveRig(newId);
        set({ rigs, activeRigId: newId || null });
        setLiveStatusText(`Saved "${trimmed}".`);
      } catch {
        setLiveStatusText(rigErrorMessage('save'));
      }
    },

    async rename(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existing = get().rigs.find((r) => r.id === id);
      if (!existing) return;
      try {
        const settings = await getApi().saveRig({ ...existing, name: trimmed });
        set({ rigs: settings.rigs || [] });
      } catch {
        setLiveStatusText(rigErrorMessage('rename'));
      }
    },

    async remove(id) {
      try {
        const settings = await getApi().deleteRig(id);
        set({ rigs: settings.rigs || [], activeRigId: settings.activeRigId || null });
      } catch {
        setLiveStatusText(rigErrorMessage('delete'));
      }
    },

    async saveBaseline() {
      const state = get();
      const existing = state.rigs.find((r) => r.id === state.activeRigId);
      const live = useLiveCaptureStore.getState();
      const deviceName = deviceNameFor(live.selectedDevice, live.devices);
      const baseline = { ...getPreflight().snapshotRig(live.channelConfig, deviceName), savedAt: new Date().toISOString() };
      const prevIds = new Set(state.rigs.map((r) => r.id));
      const existingRef: ExistingRig | null = existing ? { id: existing.id, name: existing.name } : null;
      try {
        const snapshot = { ...captureCurrentRigSnapshot(currentLiveSnapshotInput(), existingRef, existing ? existing.name : 'Rig'), baseline };
        const settings = await getApi().saveRig(snapshot);
        const rigs = settings.rigs || [];
        let savedId = existing ? existing.id : '';
        if (!savedId) {
          const created = rigs.find((r) => !prevIds.has(r.id));
          savedId = created ? created.id : '';
        }
        if (savedId) await getApi().setActiveRig(savedId);
        set({ rigs, activeRigId: savedId || state.activeRigId });
        setLiveStatusText('Baseline saved.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        setLiveStatusText(/Pro license/i.test(msg)
          ? 'Saving a baseline requires a Pro license.'
          : 'Could not save baseline — check that Sound Buddy can write its settings.');
      }
    },

    setLocked(locked) {
      set({ locked });
    },
  }));
}

export const useRigStore = createRigStore(getSoundBuddy);
