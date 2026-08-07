// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  captureCurrentRigSnapshot,
  applyRigPatch,
  rigOptionsView,
  relativeTime,
  preflightViewModel,
  type CaptureRigSnapshotInput,
  type ExistingRig,
} from './rig-panel';
import type { CaptureRig } from '../../electron/ipc/api';
import type { LiveDevice, StripConfig } from './live-capture-panel';

// rig-reconcile.js and preflight.js are real, pure classic-script modules —
// same convention as liveCaptureStore.test.ts's armState/groupState requires.
const rigReconcile = require('../rig-reconcile.js');
const preflight = require('../preflight.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { rigReconcile, preflight };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const BASE_LIVE: CaptureRigSnapshotInput = {
  channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
  channelGroups: [],
  measurementSource: null,
  liveMode: 'monitor',
  recordDir: '',
  selectedDeviceName: 'Scarlett 18i20',
  intervalMs: 100,
  windowSecs: 3,
};

describe('captureCurrentRigSnapshot', () => {
  it('builds a fresh (unsaved) rig with an empty id', () => {
    const rig = captureCurrentRigSnapshot(BASE_LIVE, null, 'My Rig');
    expect(rig.id).toBe('');
    expect(rig.name).toBe('My Rig');
    expect(rig.deviceName).toBe('Scarlett 18i20');
    expect(rig.mode).toBe('monitor');
  });

  it('trims and caps an overlong label at the MAX_LABEL_LEN boundary', () => {
    const live: CaptureRigSnapshotInput = {
      ...BASE_LIVE,
      channelConfig: [{ kind: 'mono', a: 0, b: 1, label: `  ${'x'.repeat(60)}  ` }],
    };
    const rig = captureCurrentRigSnapshot(live, null, 'Rig');
    expect(rig.channelConfig[0].label).toHaveLength(40);
    expect(rig.channelConfig[0].label).toBe('x'.repeat(40));
  });

  it('drops an all-whitespace label rather than saving it', () => {
    const live: CaptureRigSnapshotInput = { ...BASE_LIVE, channelConfig: [{ kind: 'mono', a: 0, b: 1, label: '   ' }] };
    const rig = captureCurrentRigSnapshot(live, null, 'Rig');
    expect(rig.channelConfig[0].label).toBeUndefined();
  });

  it('reuses the existing id when updating a saved rig', () => {
    const existing: ExistingRig = { id: 'rig-1', name: 'Old name' };
    const rig = captureCurrentRigSnapshot(BASE_LIVE, existing, 'New name');
    expect(rig.id).toBe('rig-1');
    expect(rig.name).toBe('New name');
  });

  it('carries an existing baseline forward', () => {
    const existing: ExistingRig = {
      id: 'rig-1', name: 'Rig', baseline: { deviceName: 'x', strips: [], savedAt: '2026-01-01T00:00:00.000Z' },
    };
    const rig = captureCurrentRigSnapshot(BASE_LIVE, existing, 'Rig');
    expect(rig.baseline).toEqual(existing.baseline);
  });

  it('omits baseline for a fresh rig with no existing entry', () => {
    const rig = captureCurrentRigSnapshot(BASE_LIVE, null, 'Rig');
    expect(rig.baseline).toBeUndefined();
  });

  it('maps channel groups to plain {name, members} entries', () => {
    const live: CaptureRigSnapshotInput = {
      ...BASE_LIVE,
      channelGroups: [{ name: 'Drums', members: [0, 1], collapsed: true }],
    };
    const rig = captureCurrentRigSnapshot(live, null, 'Rig') as CaptureRig & { groups?: unknown };
    expect(rig.groups).toEqual([{ name: 'Drums', members: [0, 1] }]);
  });

  it('carries the measurement source through', () => {
    const live: CaptureRigSnapshotInput = { ...BASE_LIVE, measurementSource: 2 };
    const rig = captureCurrentRigSnapshot(live, null, 'Rig') as CaptureRig & { measurementSource?: unknown };
    expect(rig.measurementSource).toBe(2);
  });
});

const DEVICES: LiveDevice[] = [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }];

function makeRig(overrides: Partial<CaptureRig> = {}): CaptureRig {
  return {
    id: 'rig-1',
    name: 'Rig',
    deviceName: 'Scarlett 18i20',
    channelConfig: [{ kind: 'mono', a: 0, b: 0 }],
    mode: 'monitor',
    recordDir: '',
    intervalMs: 100,
    windowSecs: 3,
    ...overrides,
  };
}

describe('applyRigPatch', () => {
  it('resolves a found device with no notice', () => {
    const { patch, notice } = applyRigPatch(makeRig(), DEVICES, 0);
    expect(notice).toBe('');
    expect(patch.selectedDevice).toBe('0');
  });

  it('surfaces a not-found notice and falls back to the default device', () => {
    const { patch, notice } = applyRigPatch(makeRig({ deviceName: 'Missing Interface' }), DEVICES, 0);
    expect(notice).toBe('Rig device "Missing Interface" not found — select a device.');
    expect(patch.selectedDevice).toBe('');
  });

  it('clamps out-of-range channels and appends a clamp notice', () => {
    const rig = makeRig({ channelConfig: [{ kind: 'mono', a: 20, b: 20 }] });
    const { patch, notice } = applyRigPatch(rig, DEVICES, 0);
    expect(notice).toBe('Some rig channels were out of range for this device and were clamped.');
    expect((patch.channelConfig as StripConfig[])[0].a).toBeLessThan(8);
  });

  it('combines the not-found and clamp notices when both apply', () => {
    const rig = makeRig({ deviceName: 'Missing Interface', channelConfig: [{ kind: 'mono', a: 20, b: 20 }] });
    const { notice } = applyRigPatch(rig, DEVICES, 0);
    expect(notice).toBe('Rig device "Missing Interface" not found — select a device. Some channels were out of range and were clamped.');
  });

  it('carries channel groups through, filtering members past a clamped strip count', () => {
    const rig = {
      ...makeRig({ channelConfig: [{ kind: 'mono', a: 0, b: 0 }] }),
      groups: [{ name: 'Drums', members: [0, 1, 2] }],
    };
    const { patch } = applyRigPatch(rig, DEVICES, 0);
    expect(patch.channelGroups).toEqual([{ name: 'Drums', members: [0] }]);
  });

  it('normalizes a missing measurementSource (old rig) to null', () => {
    const { patch } = applyRigPatch(makeRig(), DEVICES, 0);
    expect(patch.measurementSource).toBeNull();
  });

  it('falls back to a single default mono strip when the clamped config is empty', () => {
    const rig = makeRig({ channelConfig: [] });
    const { patch } = applyRigPatch(rig, DEVICES, 0);
    expect(patch.channelConfig).toEqual([{ kind: 'mono', a: 0, b: 0 }]);
  });
});

describe('rigOptionsView', () => {
  it('shows "No saved rigs" with an empty list', () => {
    expect(rigOptionsView([])).toEqual({ placeholder: 'No saved rigs', options: [] });
  });

  it('shows "Unsaved setup" and one option per rig when rigs exist', () => {
    const rigs = [makeRig({ id: 'a', name: 'Main Board' }), makeRig({ id: 'b', name: 'Backup' })];
    expect(rigOptionsView(rigs)).toEqual({
      placeholder: 'Unsaved setup',
      options: [{ value: 'a', label: 'Main Board' }, { value: 'b', label: 'Backup' }],
    });
  });
});

describe('relativeTime', () => {
  it('returns "" for an unparseable date', () => {
    expect(relativeTime('not a date')).toBe('');
  });

  it('reports "just now" under a minute', () => {
    expect(relativeTime(new Date(Date.now() - 10_000).toISOString())).toBe('just now');
  });

  it('reports minutes under an hour', () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
  });

  it('reports hours under a day', () => {
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });

  it('reports days beyond 24 hours', () => {
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });
});

describe('preflightViewModel', () => {
  const CONFIG: StripConfig[] = [{ kind: 'mono', a: 0, b: 0 }];

  it('reports no baseline saved and a not-ready banner with no baseline', () => {
    const vm = preflightViewModel(null, CONFIG, 'Scarlett 18i20', true, 8);
    expect(vm.savedText).toBe('No baseline saved');
    expect(vm.ready).toBe(true); // no baseline is a warning, not a blocker
    expect(vm.bannerText).toBe('Ready for service');
  });

  it('reports not-ready when the device is missing', () => {
    const vm = preflightViewModel(null, CONFIG, 'Scarlett 18i20', false, 0);
    expect(vm.ready).toBe(false);
    expect(vm.bannerText).toBe('Not ready — resolve the items below');
    expect(vm.items.some((i) => i.status === 'fail')).toBe(true);
  });

  it('reports the saved-baseline relative time when a baseline exists', () => {
    const baseline = { deviceName: 'Scarlett 18i20', strips: [{ kind: 'mono' as const, a: 0, b: 0 }], savedAt: new Date(Date.now() - 60_000).toISOString() };
    const vm = preflightViewModel(baseline, CONFIG, 'Scarlett 18i20', true, 8);
    expect(vm.savedText).toBe('Baseline saved 1m ago');
  });
});
