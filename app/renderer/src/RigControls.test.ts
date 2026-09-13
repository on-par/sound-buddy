// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RigControls, { changeRig } from './RigControls';
import { useRigStore } from './stores/rigStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import type { CaptureRig } from '../../electron/ipc/api';
import type { LiveCaptureRuntime } from './LiveControls';

const INITIAL_RIG_STATE = useRigStore.getInitialState();

afterEach(() => {
  useRigStore.setState({
    rigs: [], activeRigId: null, locked: false,
    loadRigs: INITIAL_RIG_STATE.loadRigs,
    selectRig: INITIAL_RIG_STATE.selectRig,
    save: INITIAL_RIG_STATE.save,
    saveAs: INITIAL_RIG_STATE.saveAs,
    rename: INITIAL_RIG_STATE.rename,
    remove: INITIAL_RIG_STATE.remove,
    saveBaseline: INITIAL_RIG_STATE.saveBaseline,
    setLocked: INITIAL_RIG_STATE.setLocked,
  });
  useLiveCaptureStore.setState({
    isCapturing: false,
    liveMode: 'monitor',
    windowSecs: 3,
    meterIntervalMs: 100,
    startCapture: useLiveCaptureStore.getInitialState().startCapture,
    stopCapture: useLiveCaptureStore.getInitialState().stopCapture,
    restartMonitorCapture: useLiveCaptureStore.getInitialState().restartMonitorCapture,
  });
  delete (globalThis as { window?: unknown }).window;
});

function renderMarkup(): string {
  return renderToString(createElement(RigControls));
}

const RIGS: CaptureRig[] = [
  { id: 'a', name: 'Main Board', deviceName: 'x', channelConfig: [], mode: 'monitor', recordDir: '', intervalMs: 100, windowSecs: 3 },
  { id: 'b', name: 'Broadcast Rig', deviceName: 'y', channelConfig: [], mode: 'record', recordDir: '', intervalMs: 200, windowSecs: 5 },
];

describe('RigControls', () => {
  it('shows "No saved rigs" with an empty list', () => {
    expect(renderMarkup()).toContain('No saved rigs');
  });

  it('shows "Unsaved setup" and lists each rig once rigs exist', () => {
    useRigStore.setState({ rigs: RIGS });
    const html = renderMarkup();
    expect(html).toContain('Unsaved setup');
    expect(html).toContain('Main Board');
  });

  it('selects the active rig in the <select>', () => {
    useRigStore.setState({ rigs: RIGS, activeRigId: 'a' });
    expect(renderMarkup()).toContain('<option value="a" selected="">Main Board</option>');
  });

  it('keeps the select enabled while locked but still locks Save/Save As', () => {
    useRigStore.setState({ locked: true });
    const html = renderMarkup();
    const select = html.match(/<select id="rig-select"[^>]*>/)?.[0] ?? '';
    expect(select).not.toContain(' disabled');
    expect(select).toContain('aria-disabled="false"');
    expect(html).toContain('id="rig-save-btn" class="ghost-btn sm" title="Update the selected rig" disabled=""');
    expect(html).toContain('id="rig-saveas-btn" class="ghost-btn sm" title="Save the current setup as a new rig" disabled=""');
  });

  it('unlocks the select when not locked', () => {
    expect(renderMarkup()).toContain('aria-disabled="false"');
  });

  it('disables Rename/Delete with no active rig', () => {
    const html = renderMarkup();
    expect(html).toContain('id="rig-rename-btn" class="ghost-btn sm" title="Rename the selected rig" disabled=""');
    expect(html).toContain('id="rig-delete-btn" class="ghost-btn sm" title="Delete the selected rig" disabled=""');
  });

  it('enables Rename/Delete once a rig is active and unlocked', () => {
    useRigStore.setState({ rigs: RIGS, activeRigId: 'a' });
    const html = renderMarkup();
    expect(html).not.toContain('id="rig-rename-btn" class="ghost-btn sm" title="Rename the selected rig" disabled=""');
    expect(html).not.toContain('id="rig-delete-btn" class="ghost-btn sm" title="Delete the selected rig" disabled=""');
  });

  it('Save/Save As stay enabled with no active rig (Save falls back to Save As)', () => {
    const html = renderMarkup();
    expect(html).not.toContain('id="rig-save-btn" class="ghost-btn sm" title="Update the selected rig" disabled=""');
    expect(html).not.toContain('id="rig-saveas-btn" class="ghost-btn sm" title="Save the current setup as a new rig" disabled=""');
  });
});

describe('changeRig', () => {
  function mockRuntime(): LiveCaptureRuntime {
    return {
      changeMeasurementSource: vi.fn(),
      chooseRecordFolder: vi.fn(async () => {}),
      beforeStartCapture: vi.fn(() => ({ ok: true }) as const),
      onCaptureStarting: vi.fn(),
      onCaptureStarted: vi.fn(),
      onCaptureStopping: vi.fn(),
      onCaptureStopped: vi.fn(),
      promoteToRecording: vi.fn(async () => {}),
    };
  }

  it('applies a rig and restarts the monitor stream while live monitoring', async () => {
    const restartMonitorCapture = vi.fn(async () => ({ success: true }));
    const selectRig = vi.fn(async (id: string) => { useRigStore.setState({ activeRigId: id || null }); });
    useRigStore.setState({ rigs: RIGS, activeRigId: 'a', selectRig });
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor', restartMonitorCapture });

    await changeRig('b', mockRuntime());

    expect(selectRig).toHaveBeenCalledWith('b');
    expect(restartMonitorCapture).toHaveBeenCalledTimes(1);
  });

  it('confirms before changing rigs during recording, then restarts with the current cadence', async () => {
    const order: string[] = [];
    const rt = mockRuntime();
    const rigDialog = vi.fn().mockResolvedValue(true);
    (globalThis as { window?: unknown }).window = { rigDialog };
    const selectRig = vi.fn(async (id: string) => { useRigStore.setState({ activeRigId: id || null }); });
    useRigStore.setState({ rigs: RIGS, activeRigId: 'a', selectRig });
    useLiveCaptureStore.setState({
      isCapturing: true,
      liveMode: 'record',
      windowSecs: 5,
      meterIntervalMs: 250,
      stopCapture: vi.fn(async () => {
        order.push('stop');
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: '/tmp/takes/session-1' };
      }),
      startCapture: vi.fn(async (opts) => {
        order.push(`start:${opts.windowSecs}/${opts.intervalSecs}`);
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await changeRig('b', rt);

    expect(rigDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Change rig?',
      msg: expect.stringContaining('Broadcast Rig'),
      confirmLabel: 'Change',
      withInput: false,
    }));
    expect(order).toEqual(['stop', 'start:5/0.25']);
    expect(useRigStore.getState().activeRigId).toBe('b');
  });

  it('leaves an active recording alone when the rig-change confirmation is cancelled', async () => {
    const rt = mockRuntime();
    const rigDialog = vi.fn().mockResolvedValue(null);
    (globalThis as { window?: unknown }).window = { rigDialog };
    const stopCapture = vi.fn();
    const startCapture = vi.fn();
    useRigStore.setState({ rigs: RIGS, activeRigId: 'a' });
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'record', stopCapture, startCapture });

    await changeRig('b', rt);

    expect(stopCapture).not.toHaveBeenCalled();
    expect(startCapture).not.toHaveBeenCalled();
    expect(useRigStore.getState().activeRigId).toBe('a');
  });
});
