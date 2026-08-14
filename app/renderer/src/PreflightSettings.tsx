// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The pre-service Preflight checklist (TD-001 slice 6d, #702), relocated from
// the Live tab's PreflightPanel into Settings → Audio (#757) — the Live tab
// is now always-monitoring with a top-bar-only Record transport, so the
// full-screen gate is gone and the checklist lives next to the rig/device
// controls it validates. Rendered directly as JSX inside SettingsPanel.tsx
// (no createPortal — see that file's header for why), reusing ADR-0007's
// "settings composes moved controls directly" pattern, and Pro-gated by the
// shared `body.not-pro #settings-pane-audio > :not(.pro-gate)` rule exactly
// like RigControls/LiveSourceSettings/etc. A pure function of rigStore +
// liveCaptureStore state (via useStoreShallow), so the "recompute preflight
// after every config change" problem the old imperative renderPreflight()
// call-sites solved by hand disappears — React just re-renders whenever
// channelConfig/channelGroups/selectedDevice/devices/rigs/activeRigId change.
// The same view-model + Save-baseline action the old panel used
// (preflightViewModel / getRigReconcile from rig-panel.ts).

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, deviceNameFor } from './stores/liveCaptureStore';
import { useRigStore } from './stores/rigStore';
import { preflightViewModel, getRigReconcile } from './rig-panel';
import { deviceChannelCount } from './live-capture-panel';

export default function PreflightSettings(): JSX.Element {
  const { channelConfig, devices, selectedDevice } = useStoreShallow(useLiveCaptureStore, (s) => ({
    channelConfig: s.channelConfig,
    devices: s.devices,
    selectedDevice: s.selectedDevice,
  }));
  const { rigs, activeRigId } = useStoreShallow(useRigStore, (s) => ({
    rigs: s.rigs,
    activeRigId: s.activeRigId,
  }));

  const activeRig = rigs.find((r) => r.id === activeRigId) ?? null;
  const deviceName = deviceNameFor(selectedDevice, devices);
  // Reconciles the device actually selected in the dropdown — the one Start
  // Capture will use — not the rig's stored deviceName; those two can
  // diverge (e.g. the engineer changes the dropdown without saving), and
  // validating the wrong one would let a stale "Ready for service" mask an
  // unvalidated capture device.
  const rec = getRigReconcile().reconcileRigDevice(deviceName, devices);
  const deviceChannels = deviceChannelCount(selectedDevice, devices);
  const vm = preflightViewModel(activeRig?.baseline ?? null, channelConfig, rec.deviceName, rec.found, deviceChannels);

  return (
    <>
      <div className="pf-head">
        <span className="section-label">Preflight</span>
        <button
          type="button"
          id="preflight-save-btn"
          className="ghost-btn sm"
          title="Save the current routing as your baseline"
          onClick={() => { void useRigStore.getState().saveBaseline(); }}
        >
          Save baseline
        </button>
      </div>
      <span className="pf-saved" id="preflight-saved">{vm.savedText}</span>
      <div className={`pf-banner pf-${vm.ready ? 'ready' : 'not-ready'}`} id="preflight-banner">{vm.bannerText}</div>
      <ul className="pf-list" id="preflight-list">
        {vm.items.map((item) => (
          <li className={`pf-row pf-${item.status}`} key={item.id}>
            <span className="pf-dot" aria-hidden="true" />
            <span className="pf-row-body">
              <span className="pf-row-label">{item.label}</span>
              <span className="pf-row-detail">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
