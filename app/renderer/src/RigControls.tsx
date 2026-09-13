// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The rig picker + Save/Save As/Rename/Delete actions (TD-001 slice 6d, #702;
// relocated from the Live tab's #rig-bar into Settings → Audio by #727) —
// rendered directly as JSX inside SettingsPanel.tsx's #settings-pane-audio
// (no createPortal — see that file's header for why), replacing
// inline-app.js's populateRigSelect/updateRigButtons/rig CRUD listeners for
// this region. Name prompts still go through window.rigDialog (inline-app.js's
// shared modal shell, also used by out-of-scope channel-group naming — see
// rig-panel.ts's header comment for why it stays imperative). The Save
// button's own "no active rig yet" prompt lives in rigStore.ts's save()
// action, not here — see that file's header.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useRigStore } from './stores/rigStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { rigOptionsView } from './rig-panel';
import { iconSvg } from './report-card';
import { captureOptsFromCadence } from './measurement-device-state';
import { runtime, startLiveCapture, stopCaptureIfRunning, type LiveCaptureRuntime } from './LiveControls';

async function confirmRecordingRigChange(rigName: string): Promise<boolean> {
  const result = await window.rigDialog?.({
    title: 'Change rig?',
    msg: `Sound Buddy will stop this recording and restart capture using "${rigName}".`,
    confirmLabel: 'Change',
    withInput: false,
  });
  return result === true;
}

export async function changeRig(id: string, rt: LiveCaptureRuntime | undefined = runtime()): Promise<void> {
  const rigState = useRigStore.getState();
  const currentId = rigState.activeRigId ?? '';
  if (id === currentId) return;

  const live = useLiveCaptureStore.getState();
  if (live.isCapturing && live.liveMode === 'record') {
    const rigName = rigState.rigs.find((r) => r.id === id)?.name ?? 'the selected rig';
    if (!(await confirmRecordingRigChange(rigName))) return;
    const opts = captureOptsFromCadence(live.windowSecs, live.meterIntervalMs);
    await stopCaptureIfRunning(rt);
    if (useLiveCaptureStore.getState().isCapturing) return;
    await useRigStore.getState().selectRig(id);
    await startLiveCapture(rt, opts.windowSecs, opts.intervalSecs);
    return;
  }

  await useRigStore.getState().selectRig(id);
  const next = useLiveCaptureStore.getState();
  if (next.isCapturing && next.liveMode === 'monitor') {
    await next.restartMonitorCapture();
  }
}

export default function RigControls(): JSX.Element {
  const { rigs, activeRigId, locked } = useStoreShallow(useRigStore, (s) => ({
    rigs: s.rigs,
    activeRigId: s.activeRigId,
    locked: s.locked,
  }));

  const { placeholder, options } = rigOptionsView(rigs);
  const activeRig = rigs.find((r) => r.id === activeRigId) ?? null;

  async function onSaveAs(): Promise<void> {
    const name = await window.rigDialog?.({ title: 'Save rig as…', value: '', confirmLabel: 'Save', withInput: true });
    if (typeof name !== 'string') return;
    await useRigStore.getState().saveAs(name);
  }

  async function onRename(): Promise<void> {
    if (!activeRig) return;
    const name = await window.rigDialog?.({ title: 'Rename rig', value: activeRig.name, confirmLabel: 'Rename', withInput: true });
    if (typeof name !== 'string') return;
    await useRigStore.getState().rename(activeRig.id, name);
  }

  async function onDelete(): Promise<void> {
    if (!activeRig) return;
    const ok = await window.rigDialog?.({
      title: 'Delete rig',
      msg: `Delete "${activeRig.name}"? This can't be undone.`,
      confirmLabel: 'Delete',
      withInput: false,
    });
    if (!ok) return;
    await useRigStore.getState().remove(activeRig.id);
  }

  return (
    <>
      <label className="select-label">
        <span>Rig</span>
        <div className="select-row">
          <div className="select-wrap">
            <select
              id="rig-select"
              value={activeRigId ?? ''}
              aria-disabled={false}
              onChange={(e) => { void changeRig(e.target.value); }}
            >
              <option value="">{placeholder}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
        </div>
      </label>
      <div className="rig-actions">
        <button
          type="button"
          id="rig-save-btn"
          className="ghost-btn sm"
          title="Update the selected rig"
          disabled={locked}
          onClick={() => { void useRigStore.getState().save(); }}
        >
          Save
        </button>
        <button
          type="button"
          id="rig-saveas-btn"
          className="ghost-btn sm"
          title="Save the current setup as a new rig"
          disabled={locked}
          onClick={() => { void onSaveAs(); }}
        >
          Save As…
        </button>
        <button
          type="button"
          id="rig-rename-btn"
          className="ghost-btn sm"
          title="Rename the selected rig"
          disabled={locked || !activeRig}
          onClick={() => { void onRename(); }}
        >
          Rename
        </button>
        <button
          type="button"
          id="rig-delete-btn"
          className="ghost-btn sm"
          title="Delete the selected rig"
          disabled={locked || !activeRig}
          onClick={() => { void onDelete(); }}
        >
          Delete
        </button>
      </div>
    </>
  );
}
