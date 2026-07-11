import { describe, it, expect } from 'vitest';

// The reconciler is a plain classic script (window.rigReconcile in the browser,
// module.exports under Node) so it can be exercised here without a DOM.
const { reconcileRigDevice, clampChannelConfig, resolveStripLabel } = require('./rig-reconcile.js') as {
  reconcileRigDevice: (
    deviceName: string,
    devices: Array<{ index: number; name: string; channels: number }>,
  ) => { found: boolean; index: string; deviceName: string };
  clampChannelConfig: (
    channelConfig: Array<{ kind: string; a: number; b: number; label?: string }>,
    maxChannels: number,
  ) => { config: Array<{ kind: string; a: number; b: number; label?: string }>; adjusted: boolean };
  resolveStripLabel: (
    strip: { label?: string } | null,
    ch: { name?: string } | null,
    index: number,
  ) => string;
};

const DEVICES = [
  { index: 0, name: 'Built-in Mic', channels: 2 },
  { index: 3, name: 'Scarlett 18i20', channels: 18 },
];

describe('reconcileRigDevice', () => {
  it('matches a device by name and returns its index as a string', () => {
    // Index 3, not the array position, proves the match is by name not order.
    expect(reconcileRigDevice('Scarlett 18i20', DEVICES)).toEqual({
      found: true,
      index: '3',
      deviceName: 'Scarlett 18i20',
    });
  });

  it('reports found=false with a blank index when the named device is absent', () => {
    expect(reconcileRigDevice('Scarlett 18i20', [DEVICES[0]])).toEqual({
      found: false,
      index: '',
      deviceName: 'Scarlett 18i20',
    });
  });

  it('treats an empty device name as the always-resolvable Default Device', () => {
    expect(reconcileRigDevice('', DEVICES)).toEqual({ found: true, index: '', deviceName: '' });
  });

  it('tolerates a non-array device list (still resolves the default device)', () => {
    expect(reconcileRigDevice('', undefined as unknown as [])).toEqual({
      found: true,
      index: '',
      deviceName: '',
    });
    expect(reconcileRigDevice('Anything', null as unknown as [])).toEqual({
      found: false,
      index: '',
      deviceName: 'Anything',
    });
  });
});

describe('clampChannelConfig', () => {
  it('leaves an in-range config untouched and reports adjusted=false', () => {
    const cfg = [
      { kind: 'mono', a: 0, b: 1 },
      { kind: 'stereo', a: 0, b: 1 },
    ];
    const out = clampChannelConfig(cfg, 8);
    expect(out.adjusted).toBe(false);
    expect(out.config).toEqual(cfg);
    // A fresh array/objects — mutating the result must not touch the input.
    expect(out.config).not.toBe(cfg);
    expect(out.config[0]).not.toBe(cfg[0]);
  });

  it('clamps an out-of-range stereo strip and flags the adjustment', () => {
    // a=8,b=9 saved on an 18ch interface, now on a 2ch device (indices 0..1).
    const out = clampChannelConfig([{ kind: 'stereo', a: 8, b: 9 }], 2);
    expect(out.adjusted).toBe(true);
    expect(out.config).toEqual([{ kind: 'stereo', a: 1, b: 1 }]);
  });

  it('clamps a mono strip whose channel exceeds the device', () => {
    const out = clampChannelConfig([{ kind: 'mono', a: 5, b: 0 }], 2);
    expect(out.adjusted).toBe(true);
    expect(out.config).toEqual([{ kind: 'mono', a: 1, b: 0 }]);
  });

  it('does not flag adjustment when only a mono strip\'s ignored right leg is out of range', () => {
    // b is meaningless for a mono strip, so clamping it must not raise a notice.
    const out = clampChannelConfig([{ kind: 'mono', a: 0, b: 9 }], 2);
    expect(out.adjusted).toBe(false);
    expect(out.config).toEqual([{ kind: 'mono', a: 0, b: 1 }]);
  });

  it('preserves a per-channel label (written by #39) through the clamp', () => {
    const out = clampChannelConfig([{ kind: 'stereo', a: 8, b: 9, label: 'Drums OH' }], 2);
    expect(out.config[0].label).toBe('Drums OH');
  });

  it('returns an empty config for a non-array input', () => {
    expect(clampChannelConfig(undefined as unknown as [], 8)).toEqual({ config: [], adjusted: false });
  });

  it('falls back to a single valid channel when the device count is 0/NaN', () => {
    // hi collapses to 0, so every leg lands on channel 0 without throwing.
    const out = clampChannelConfig([{ kind: 'stereo', a: 4, b: 5 }], 0);
    expect(out.config).toEqual([{ kind: 'stereo', a: 0, b: 0 }]);
    expect(out.adjusted).toBe(true);
  });

  it('defaults missing/non-finite leg indices to channel 0', () => {
    const out = clampChannelConfig(
      [{ kind: 'stereo', a: NaN as unknown as number, b: undefined as unknown as number }],
      8,
    );
    expect(out.config).toEqual([{ kind: 'stereo', a: 0, b: 0 }]);
    expect(out.adjusted).toBe(false);
  });
});

describe('resolveStripLabel', () => {
  const CH = { name: 'USB Audio 3' };

  it('uses a non-empty label verbatim (trimmed), over the device name', () => {
    expect(resolveStripLabel({ label: 'Kick' }, CH, 0)).toBe('Kick');
    expect(resolveStripLabel({ label: '  SL Vox  ' }, CH, 0)).toBe('SL Vox');
  });

  it('falls back to the backend device name when the label is empty', () => {
    expect(resolveStripLabel({ label: '' }, CH, 0)).toBe('USB Audio 3');
    expect(resolveStripLabel({}, CH, 0)).toBe('USB Audio 3');
  });

  it('treats a whitespace-only label as empty', () => {
    expect(resolveStripLabel({ label: '   ' }, CH, 0)).toBe('USB Audio 3');
  });

  it('falls back to "Ch N" (index + 1) with no label and no backend name', () => {
    expect(resolveStripLabel({ label: '' }, null, 4)).toBe('Ch 5');
    expect(resolveStripLabel({}, { name: '' }, 0)).toBe('Ch 1');
    expect(resolveStripLabel({}, { name: '   ' }, 2)).toBe('Ch 3');
  });

  it('tolerates a null strip and a non-finite index', () => {
    expect(resolveStripLabel(null, CH, 0)).toBe('USB Audio 3');
    expect(resolveStripLabel(null, null, NaN as unknown as number)).toBe('Ch 1');
  });
});
