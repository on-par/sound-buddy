import { describe, it, expect } from 'vitest';

// track-workspace is a plain classic script (window.trackWorkspace / module.exports).
const { idleChannel, addEnabled, isEmpty, nextUnusedChannel } = require('./track-workspace.js') as {
  idleChannel: (bandKeys: string[]) => {
    name: undefined;
    rms: number;
    peak: number;
    clipping: boolean;
    centroid: null;
    bands: Record<string, number>;
    idle: true;
  };
  addEnabled: (used: number, total: number, recording: boolean) => boolean;
  isEmpty: (configuredCount: number) => boolean;
  nextUnusedChannel: (config: Strip[] | null, totalChannels: number) => number;
};
type Strip = { kind: string; a: number; b: number };

const BAND_KEYS = ['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'];

describe('idleChannel', () => {
  it('floors every band key to -120', () => {
    const ch = idleChannel(BAND_KEYS);
    for (const k of BAND_KEYS) expect(ch.bands[k]).toBe(-120);
  });
  it('has non-finite rms/peak', () => {
    const ch = idleChannel(BAND_KEYS);
    expect(Number.isFinite(ch.rms)).toBe(false);
    expect(Number.isFinite(ch.peak)).toBe(false);
  });
  it('is not clipping and carries the idle marker', () => {
    const ch = idleChannel(BAND_KEYS);
    expect(ch.clipping).toBe(false);
    expect(ch.idle).toBe(true);
  });
  it('tolerates an empty band-key list', () => { expect(idleChannel([]).bands).toEqual({}); });
});

describe('addEnabled', () => {
  it('is true with channels free and not recording', () => expect(addEnabled(2, 8, false)).toBe(true));
  it('is false at the device channel cap', () => expect(addEnabled(8, 8, false)).toBe(false));
  it('is false while recording, even with channels free', () => expect(addEnabled(2, 8, true)).toBe(false));
  it('is false at the cap while recording', () => expect(addEnabled(8, 8, true)).toBe(false));
});

describe('isEmpty', () => {
  it('is true with zero configured tracks', () => expect(isEmpty(0)).toBe(true));
  it('is false with at least one configured track', () => expect(isEmpty(1)).toBe(false));
  it('is false with several configured tracks', () => expect(isEmpty(3)).toBe(false));
});

describe('nextUnusedChannel (#1403)', () => {
  it('is 0 for an empty config', () => expect(nextUnusedChannel([], 8)).toBe(0));
  it('picks the lowest unreferenced index', () => {
    expect(nextUnusedChannel([{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }], 8)).toBe(2);
    expect(nextUnusedChannel([{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 2, b: 3 }], 8)).toBe(1);
  });
  it('skips both legs of a stereo strip', () => {
    expect(nextUnusedChannel([{ kind: 'stereo', a: 0, b: 1 }], 8)).toBe(2);
  });
  it('falls back to the last valid index once every input is referenced', () => {
    const full: Strip[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'mono', a: i, b: i }));
    expect(nextUnusedChannel(full, 8)).toBe(7);
  });
  it('treats a null config as empty', () => expect(nextUnusedChannel(null, 8)).toBe(0));
  it('clamps a zero total channel count to at least one input', () => expect(nextUnusedChannel([], 0)).toBe(0));
});
