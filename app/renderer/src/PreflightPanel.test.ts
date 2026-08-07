// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import PreflightPanel from './PreflightPanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRigStore } from './stores/rigStore';
import type { CaptureRig } from '../../electron/ipc/api';
import type { LiveDevice } from './live-capture-panel';

// rig-reconcile.js/preflight.js are real, pure classic-script modules — same
// convention as liveCaptureStore.test.ts's armState/groupState requires.
const rigReconcile = require('../rig-reconcile.js');
const preflight = require('../preflight.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { rigReconcile, preflight };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({ devices: [], selectedDevice: '', channelConfig: [] });
  useRigStore.setState({ rigs: [], activeRigId: null });
});

function renderMarkup(): string {
  return renderToString(createElement(PreflightPanel));
}

const DEVICES: LiveDevice[] = [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }];

function makeRig(overrides: Partial<CaptureRig> = {}): CaptureRig {
  return {
    id: 'a', name: 'Rig', deviceName: 'Scarlett 18i20', channelConfig: [],
    mode: 'monitor', recordDir: '', intervalMs: 100, windowSecs: 3,
    ...overrides,
  };
}

describe('PreflightPanel', () => {
  it('always renders the save-baseline button', () => {
    expect(renderMarkup()).toContain('id="preflight-save-btn"');
  });

  it('shows "No baseline saved" with no active rig baseline', () => {
    expect(renderMarkup()).toContain('No baseline saved');
  });

  it('renders the ready banner when the checklist passes', () => {
    useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 0, b: 0 }] });
    const html = renderMarkup();
    expect(html).toContain('pf-banner pf-ready');
    expect(html).toContain('Ready for service');
  });

  it('renders the not-ready banner when a channel is out of range for the device', () => {
    useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 20, b: 20 }] });
    const html = renderMarkup();
    expect(html).toContain('pf-banner pf-not-ready');
    expect(html).toContain('Not ready — resolve the items below');
    expect(html).toContain('pf-row pf-fail');
  });

  it('shows the saved-baseline text and ready banner when the setup matches', () => {
    const baseline = { deviceName: 'Scarlett 18i20', strips: [{ kind: 'mono' as const, a: 0, b: 0, label: '' }], savedAt: new Date().toISOString() };
    useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 0, b: 0 }] });
    useRigStore.setState({ rigs: [makeRig({ baseline })], activeRigId: 'a' });
    const html = renderMarkup();
    expect(html).toContain('Baseline saved');
    expect(html).toContain('pf-banner pf-ready');
  });

  it('renders one checklist row per item', () => {
    useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 0, b: 0 }] });
    const html = renderMarkup();
    expect((html.match(/class="pf-row /g) || []).length).toBe(3);
  });
});
