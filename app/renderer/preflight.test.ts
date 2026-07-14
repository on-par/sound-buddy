import { describe, it, expect } from 'vitest';

// preflight is a plain classic script (window.preflight / module.exports) so the
// snapshot/drift/checklist rules are exercised without a DOM.
const { snapshotRig, detectDrift, buildChecklist, checklistSummary } = require('./preflight.js') as {
  snapshotRig: (channelConfig: Strip[] | null, deviceName: string | null | undefined) => Snapshot;
  detectDrift: (baseline: Snapshot | null, current: Snapshot | null) => DriftItem[];
  buildChecklist: (opts: { baseline?: Snapshot | null; current?: Snapshot; device?: Device }) => ChecklistItem[];
  checklistSummary: (items: ChecklistItem[] | null) => { counts: { ok: number; warn: number; fail: number }; ready: boolean };
};

type Strip = { kind: string; a: number; b: number; label?: string; armed?: boolean };
type SnapStrip = { kind: string; a: number; b: number; label: string };
type Snapshot = { deviceName: string; strips: SnapStrip[] };
type DriftItem = { type: string; index: number; label: string; from: unknown; to: unknown };
type Device = { found: boolean; name: string; channels: number };
type ChecklistItem = { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string };

describe('snapshotRig', () => {
  it('normalizes mono and stereo kinds', () => {
    const snap = snapshotRig(
      [{ kind: 'mono', a: 0, b: 1 }, { kind: 'stereo', a: 2, b: 3 }],
      'Scarlett 18i20',
    );
    expect(snap.strips.map((s) => s.kind)).toEqual(['mono', 'stereo']);
  });

  it('coerces any non-"stereo" kind to mono', () => {
    const snap = snapshotRig([{ kind: 'weird', a: 0, b: 0 } as unknown as Strip], '');
    expect(snap.strips[0].kind).toBe('mono');
  });

  it('defaults missing/non-finite a and b to 0', () => {
    const snap = snapshotRig([{ kind: 'mono' } as unknown as Strip, { kind: 'mono', a: NaN, b: undefined } as unknown as Strip], '');
    expect(snap.strips[0]).toMatchObject({ a: 0, b: 0 });
    expect(snap.strips[1]).toMatchObject({ a: 0, b: 0 });
  });

  it('defaults an absent label to empty string', () => {
    const snap = snapshotRig([{ kind: 'mono', a: 0, b: 0 }], '');
    expect(snap.strips[0].label).toBe('');
  });

  it('preserves a string label', () => {
    const snap = snapshotRig([{ kind: 'mono', a: 0, b: 0, label: 'Vocal' }], '');
    expect(snap.strips[0].label).toBe('Vocal');
  });

  it('deliberately drops the armed flag — arming is not routing', () => {
    const snap = snapshotRig([{ kind: 'mono', a: 0, b: 0, armed: false }], '');
    expect(snap.strips[0]).not.toHaveProperty('armed');
  });

  it('treats null/non-array channelConfig as an empty strip list', () => {
    expect(snapshotRig(null, '').strips).toEqual([]);
    expect(snapshotRig('not-an-array' as unknown as Strip[], '').strips).toEqual([]);
  });

  it('normalizes an empty/undefined deviceName to ""', () => {
    expect(snapshotRig([], '').deviceName).toBe('');
    expect(snapshotRig([], undefined).deviceName).toBe('');
    expect(snapshotRig([], null).deviceName).toBe('');
  });

  it('returns fresh strip objects — the input is not mutated', () => {
    const input = [{ kind: 'mono', a: 0, b: 0, label: 'X' }];
    const snap = snapshotRig(input, 'Dev');
    snap.strips[0].label = 'changed';
    snap.strips[0].a = 99;
    expect(input[0]).toEqual({ kind: 'mono', a: 0, b: 0, label: 'X' });
  });
});

const mono = (a: number, b = a, label?: string): Strip => ({ kind: 'mono', a, b, ...(label ? { label } : {}) });
const stereo = (a: number, b: number, label?: string): Strip => ({ kind: 'stereo', a, b, ...(label ? { label } : {}) });
const snap = (deviceName: string, strips: Strip[]): Snapshot => snapshotRig(strips, deviceName);

describe('detectDrift', () => {
  it('returns [] for an identical baseline and current', () => {
    const s = snap('Scarlett', [mono(0), stereo(2, 3)]);
    expect(detectDrift(s, s)).toEqual([]);
  });

  it('reports a device change', () => {
    const drift = detectDrift(snap('Scarlett', []), snap('Focusrite', []));
    expect(drift).toEqual([{ type: 'device', index: -1, label: 'Input device', from: 'Scarlett', to: 'Focusrite' }]);
  });

  it('reports a device change from empty to Default Device wording', () => {
    const drift = detectDrift(snap('', []), snap('Focusrite', []));
    expect(drift[0]).toMatchObject({ from: 'Default Device', to: 'Focusrite' });
  });

  it('reports a strip added', () => {
    const drift = detectDrift(snap('', [mono(0)]), snap('', [mono(0), mono(1)]));
    expect(drift).toEqual([{ type: 'added', index: 1, label: 'Ch 2', from: null, to: '1' }]);
  });

  it('reports a strip removed', () => {
    const drift = detectDrift(snap('', [mono(0), mono(1)]), snap('', [mono(0)]));
    expect(drift).toEqual([{ type: 'removed', index: 1, label: 'Ch 2', from: '1', to: null }]);
  });

  it('reports mono → stereo as a kind change', () => {
    const drift = detectDrift(snap('', [mono(0)]), snap('', [stereo(0, 1)]));
    expect(drift).toEqual([{ type: 'kind', index: 0, label: 'Ch 1', from: 'mono', to: 'stereo' }]);
  });

  it('reports a mono channel reassignment', () => {
    const drift = detectDrift(snap('', [mono(0)]), snap('', [mono(5)]));
    expect(drift).toEqual([{ type: 'channel', index: 0, label: 'Ch 1', from: '0', to: '5' }]);
  });

  it('reports a stereo leg reassignment', () => {
    const drift = detectDrift(snap('', [stereo(2, 3)]), snap('', [stereo(2, 5)]));
    expect(drift).toEqual([{ type: 'channel', index: 0, label: 'Ch 1', from: '2-3', to: '2-5' }]);
  });

  it('treats a stereo strip collapsing to one channel (a===b) via its token', () => {
    // Collapsed stereo (a===b) tokenizes as mono — same kind, different token.
    const drift = detectDrift(snap('', [stereo(2, 3)]), snap('', [stereo(2, 2)]));
    expect(drift).toEqual([{ type: 'channel', index: 0, label: 'Ch 1', from: '2-3', to: '2' }]);
  });

  it('reports a label-only change', () => {
    const drift = detectDrift(snap('', [mono(0, 0, 'Old')]), snap('', [mono(0, 0, 'New')]));
    expect(drift).toEqual([{ type: 'label', index: 0, label: 'New', from: 'Old', to: 'New' }]);
  });

  it('orders combined drift: device first, then per-index', () => {
    const baseline = snap('Scarlett', [mono(0), mono(1)]);
    const current = snap('Focusrite', [mono(9), mono(1)]);
    const drift = detectDrift(baseline, current);
    expect(drift.map((d) => d.type)).toEqual(['device', 'channel']);
    expect(drift[1].index).toBe(0);
  });

  it('treats a null/missing baseline as empty — everything in current reads as added', () => {
    const drift = detectDrift(null, snap('Dev', [mono(0)]));
    expect(drift).toEqual([
      { type: 'device', index: -1, label: 'Input device', from: 'Default Device', to: 'Dev' },
      { type: 'added', index: 0, label: 'Ch 1', from: null, to: '0' },
    ]);
  });

  it('treats a null/missing current as empty — everything in baseline reads as removed', () => {
    const drift = detectDrift(snap('Dev', [mono(0)]), undefined as unknown as Snapshot);
    expect(drift).toEqual([
      { type: 'device', index: -1, label: 'Input device', from: 'Dev', to: 'Default Device' },
      { type: 'removed', index: 0, label: 'Ch 1', from: '0', to: null },
    ]);
  });
});

describe('buildChecklist', () => {
  const okDevice: Device = { found: true, name: 'Scarlett 18i20', channels: 8 };

  it('device-connected is ok when the device is found', () => {
    const items = buildChecklist({ current: snap('Scarlett 18i20', []), device: okDevice });
    const item = items.find((i) => i.id === 'device-connected')!;
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('Scarlett 18i20');
  });

  it('device-connected fails, with an actionable detail, when the device is missing', () => {
    const items = buildChecklist({ current: snap('Old Interface', []), device: { found: false, name: 'Old Interface', channels: 0 } });
    const item = items.find((i) => i.id === 'device-connected')!;
    expect(item.status).toBe('fail');
    expect(item.detail).toMatch(/Old Interface.*not connected.*plug it in or pick another input/);
  });

  it('channels-in-range is ok when every leg fits the device', () => {
    const items = buildChecklist({ current: snap('', [mono(0), stereo(1, 2)]), device: okDevice });
    const item = items.find((i) => i.id === 'channels-in-range')!;
    expect(item.status).toBe('ok');
    expect(item.detail).toBe('All 2 strips map to a valid input channel');
  });

  it('channels-in-range fails for a mono leg out of range', () => {
    const items = buildChecklist({ current: snap('', [mono(9)]), device: { found: true, name: 'Dev', channels: 2 } });
    const item = items.find((i) => i.id === 'channels-in-range')!;
    expect(item.status).toBe('fail');
    expect(item.detail).toBe('Strip 1 uses channel 10 but the device only has 2');
  });

  it('channels-in-range fails for a stereo b leg out of range', () => {
    const items = buildChecklist({ current: snap('', [stereo(0, 9)]), device: { found: true, name: 'Dev', channels: 2 } });
    const item = items.find((i) => i.id === 'channels-in-range')!;
    expect(item.status).toBe('fail');
    expect(item.detail).toBe('Strip 1 uses channel 10 but the device only has 2');
  });

  it('matches-baseline warns when there is no saved baseline yet', () => {
    const items = buildChecklist({ baseline: null, current: snap('', [mono(0)]), device: okDevice });
    const item = items.find((i) => i.id === 'matches-baseline')!;
    expect(item.status).toBe('warn');
    expect(item.detail).toMatch(/No saved baseline yet/);
  });

  it('matches-baseline warns when the saved baseline has no strips', () => {
    const items = buildChecklist({ baseline: snap('', []), current: snap('', [mono(0)]), device: okDevice });
    expect(items.find((i) => i.id === 'matches-baseline')!.status).toBe('warn');
  });

  it('matches-baseline is ok when current matches the baseline exactly', () => {
    const s = snap('Scarlett 18i20', [mono(0)]);
    const items = buildChecklist({ baseline: s, current: s, device: okDevice });
    const item = items.find((i) => i.id === 'matches-baseline')!;
    expect(item.status).toBe('ok');
    expect(item.detail).toBe('Setup matches your saved baseline');
  });

  it('matches-baseline warns when only labels changed', () => {
    const baseline = snap('', [mono(0, 0, 'Old')]);
    const current = snap('', [mono(0, 0, 'New')]);
    const items = buildChecklist({ baseline, current, device: okDevice });
    const item = items.find((i) => i.id === 'matches-baseline')!;
    expect(item.status).toBe('warn');
    expect(item.detail).toBe('Only channel labels changed');
  });

  it('matches-baseline fails with an actionable, non-empty detail on hard drift', () => {
    const baseline = snap('Scarlett 18i20', [mono(0), mono(1)]);
    const current = snap('Scarlett 18i20', [mono(5), mono(1)]);
    const items = buildChecklist({ baseline, current, device: okDevice });
    const item = items.find((i) => i.id === 'matches-baseline')!;
    expect(item.status).toBe('fail');
    expect(item.detail.length).toBeGreaterThan(0);
    expect(item.detail).toMatch(/reassigned/);
    expect(item.detail).toMatch(/update routing or re-save the baseline/);
  });

  it('summarizes multiple hard-drift items compactly, capped with a "+N more"', () => {
    const baseline = snap('Scarlett 18i20', [mono(0), mono(1), mono(2), mono(3)]);
    const current = snap('Scarlett 18i20', [mono(5), mono(6), mono(7), mono(8)]);
    const items = buildChecklist({ baseline, current, device: okDevice });
    const item = items.find((i) => i.id === 'matches-baseline')!;
    expect(item.status).toBe('fail');
    expect(item.detail).toMatch(/\+1 more/);
  });

  it('every item detail is a non-empty string', () => {
    const items = buildChecklist({ baseline: null, current: snap('', [mono(0)]), device: okDevice });
    items.forEach((item) => expect(item.detail.length).toBeGreaterThan(0));
  });
});

describe('checklistSummary', () => {
  it('tallies counts per status', () => {
    const items: ChecklistItem[] = [
      { id: 'a', label: '', status: 'ok', detail: '' },
      { id: 'b', label: '', status: 'ok', detail: '' },
      { id: 'c', label: '', status: 'warn', detail: '' },
      { id: 'd', label: '', status: 'fail', detail: '' },
    ];
    expect(checklistSummary(items).counts).toEqual({ ok: 2, warn: 1, fail: 1 });
  });

  it('ready is true when there are zero fails', () => {
    const items: ChecklistItem[] = [{ id: 'a', label: '', status: 'ok', detail: '' }, { id: 'b', label: '', status: 'warn', detail: '' }];
    expect(checklistSummary(items).ready).toBe(true);
  });

  it('ready is false when there is at least one fail', () => {
    const items: ChecklistItem[] = [{ id: 'a', label: '', status: 'ok', detail: '' }, { id: 'b', label: '', status: 'fail', detail: '' }];
    expect(checklistSummary(items).ready).toBe(false);
  });

  it('ready is true when every item is a warning (warnings never block readiness)', () => {
    const items: ChecklistItem[] = [{ id: 'a', label: '', status: 'warn', detail: '' }, { id: 'b', label: '', status: 'warn', detail: '' }];
    expect(checklistSummary(items).ready).toBe(true);
  });

  it('handles a null/non-array items list as zero counts, ready', () => {
    const summary = checklistSummary(null);
    expect(summary.counts).toEqual({ ok: 0, warn: 0, fail: 0 });
    expect(summary.ready).toBe(true);
  });
});
