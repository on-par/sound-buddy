// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RigControls from './RigControls';
import { useRigStore } from './stores/rigStore';
import type { CaptureRig } from '../../electron/ipc/api';

afterEach(() => {
  useRigStore.setState({ rigs: [], activeRigId: null, locked: false });
});

function renderMarkup(): string {
  return renderToString(createElement(RigControls));
}

const RIGS: CaptureRig[] = [
  { id: 'a', name: 'Main Board', deviceName: 'x', channelConfig: [], mode: 'monitor', recordDir: '', intervalMs: 100, windowSecs: 3 },
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

  it('locks the select and Save/Save As while locked', () => {
    useRigStore.setState({ locked: true });
    const html = renderMarkup();
    expect(html).toContain('id="rig-select" disabled=""');
    expect(html).toContain('aria-disabled="true"');
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
