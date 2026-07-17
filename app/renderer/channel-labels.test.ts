import { describe, it, expect } from 'vitest';

// channel-labels is a plain classic script (window.channelLabels / module.exports),
// same style as arm-state.js, so the overlay/persist rules are exercised without a DOM.
const { applyLabels, recordLabel } = require('./channel-labels.js') as {
  applyLabels: (
    cfg: Strip[] | null | undefined,
    tokens: string[] | null | undefined,
    savedForDevice: Record<string, string> | null | undefined,
  ) => Strip[];
  recordLabel: (
    all: Record<string, Record<string, string>> | null | undefined,
    deviceName: string,
    token: string,
    label: string,
  ) => Record<string, Record<string, string>>;
};
type Strip = { kind: string; a: number; b: number; label?: string };

describe('applyLabels', () => {
  it('overlays a saved label onto a mono strip by its token ("0")', () => {
    const cfg: Strip[] = [{ kind: 'mono', a: 0, b: 0 }];
    const out = applyLabels(cfg, ['0'], { '0': 'Kick' });
    expect(out[0].label).toBe('Kick');
  });

  it('overlays a saved label onto a stereo strip by its pair token ("2-3")', () => {
    const cfg: Strip[] = [{ kind: 'stereo', a: 2, b: 3 }];
    const out = applyLabels(cfg, ['2-3'], { '2-3': 'OH' });
    expect(out[0].label).toBe('OH');
  });

  it('never overwrites a strip that already has a non-empty label', () => {
    const cfg: Strip[] = [{ kind: 'mono', a: 0, b: 0, label: 'Rig label' }];
    const out = applyLabels(cfg, ['0'], { '0': 'Saved label' });
    expect(out[0].label).toBe('Rig label');
  });

  it('leaves a strip unchanged when its token has no saved entry', () => {
    const cfg: Strip[] = [{ kind: 'mono', a: 0, b: 0 }];
    const out = applyLabels(cfg, ['0'], { '1': 'Snare' });
    expect(out[0].label).toBeUndefined();
  });

  it('leaves strips unchanged for an empty/undefined saved map', () => {
    const cfg: Strip[] = [{ kind: 'mono', a: 0, b: 0 }];
    expect(applyLabels(cfg, ['0'], {})[0].label).toBeUndefined();
    expect(applyLabels(cfg, ['0'], undefined)[0].label).toBeUndefined();
  });

  it('is null-safe: null/undefined cfg degrades to an empty array copy', () => {
    expect(applyLabels(null, [], {})).toEqual([]);
    expect(applyLabels(undefined, [], {})).toEqual([]);
  });

  it('does not mutate the input config array', () => {
    const cfg: Strip[] = [{ kind: 'mono', a: 0, b: 0 }];
    applyLabels(cfg, ['0'], { '0': 'Kick' });
    expect(cfg[0].label).toBeUndefined();
  });
});

describe('recordLabel', () => {
  it('sets a trimmed label under the device/token', () => {
    const next = recordLabel({}, 'Scarlett 18i20', '0', '  Kick  ');
    expect(next).toEqual({ 'Scarlett 18i20': { '0': 'Kick' } });
  });

  it('caps a label at 40 characters', () => {
    const long = 'x'.repeat(50);
    const next = recordLabel({}, 'Scarlett', '0', long);
    expect(next.Scarlett['0']).toBe('x'.repeat(40));
  });

  it('deletes the token entry when the label is empty/whitespace', () => {
    const all = { Scarlett: { '0': 'Kick', '1': 'Snare' } };
    const next = recordLabel(all, 'Scarlett', '0', '   ');
    expect(next).toEqual({ Scarlett: { '1': 'Snare' } });
  });

  it('prunes the device entry once its last label is deleted', () => {
    const all = { Scarlett: { '0': 'Kick' } };
    const next = recordLabel(all, 'Scarlett', '0', '');
    expect(next).toEqual({});
  });

  it('works with the "" (Default Device) key', () => {
    const next = recordLabel({}, '', '0', 'Kick');
    expect(next).toEqual({ '': { '0': 'Kick' } });
  });

  it('does not mutate the input map', () => {
    const all = { Scarlett: { '0': 'Kick' } };
    recordLabel(all, 'Scarlett', '1', 'Snare');
    expect(all).toEqual({ Scarlett: { '0': 'Kick' } });
  });

  it('null/undefined input map degrades to a fresh map', () => {
    expect(recordLabel(null, 'Scarlett', '0', 'Kick')).toEqual({ Scarlett: { '0': 'Kick' } });
    expect(recordLabel(undefined, 'Scarlett', '0', 'Kick')).toEqual({ Scarlett: { '0': 'Kick' } });
  });
});
